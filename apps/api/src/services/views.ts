import { and, desc, eq } from 'drizzle-orm';
import type { ComputedRecommendation, GoalContent, PlanContent, PlanTransitionRecord, ReviewNarrative, StrategyContent } from '@class-pulse/domain';
import { canSee, type CaseField, type PolicyRole } from '@class-pulse/policy';
import type { Actor, AppContext } from '../context';
import { correctionRequests, goals, patternCandidates, reviewCycles, strategies, users } from '../db/schema';
import { audit } from './audit';
import { getCase, latestIntake, listSafetyFlags, roleForCase } from './cases';
import { activePlanFor } from './plans';
import { progressForGoal, recentSignals } from './signals';
import { studentForCase } from './roster';

/**
 * docs/04 layer 3 — serialization. Each role reads from a role-specific view model built here
 * from the field-visibility matrix. A guardian endpoint is structurally incapable of returning a
 * hidden field because the field is never placed into the object.
 */
export interface CaseView {
  role: PolicyRole;
  fields: CaseField[];
  [key: string]: unknown;
}

const HIDE_SECTIONS_FOR: Record<PolicyRole, Array<keyof PlanContent>> = {
  teacher: [],
  support_professional: [],
  administrator_authorized: [],
  student: ['behavioralConcern', 'documentedPatterns', 'hypothesesToMonitor', 'preventiveStrategies', 'teacherResponseStrategies', 'parentGuardianSupport', 'progressMonitoring', 'dashboardRecommendations', 'informationNotToDisplay', 'reviewCriteria', 'missingInformation', 'privacyAndHumanReviewNotes'],
  guardian: ['documentedPatterns', 'hypothesesToMonitor', 'preventiveStrategies', 'teacherResponseStrategies', 'progressMonitoring', 'dashboardRecommendations', 'informationNotToDisplay', 'reviewCriteria', 'missingInformation', 'privacyAndHumanReviewNotes'],
  administrator: [],
};

function goalForRole(g: typeof goals.$inferSelect, role: PolicyRole) {
  const c = g.content as GoalContent;
  const out: Record<string, unknown> = { id: g.id, status: g.status, targetBehavior: c.targetBehavior, observableDefinition: c.observableDefinition, direction: c.direction, reviewPeriodDays: c.reviewPeriodDays, measurementMethod: c.measurementMethod };
  if (canSee('goal.baseline', role)) out.baseline = c.baseline;
  else out.baselineStatus = c.baseline.status; // students/guardians see *that* a baseline is pending, not the raw input
  if (canSee('goal.target', role)) out.target = c.target;
  return out;
}

export async function buildCaseView(ctx: AppContext, actor: Actor, caseKey: string): Promise<CaseView> {
  const role = roleForCase(actor, caseKey);
  const c = await getCase(ctx, caseKey);
  const view: CaseView = { role, fields: [] };
  const include = (field: CaseField, value: unknown) => {
    if (!canSee(field, role)) return;
    view.fields.push(field);
    const key = field.split('.').pop()!;
    view[field.replace('.', '_')] = value;
    void key;
  };

  include('case.caseKey', caseKey);
  include('case.gradeLevel', c.gradeLevel);
  include('case.status', c.status);

  if (canSee('intake.fields', role)) {
    const intake = await latestIntake(ctx, caseKey);
    include('intake.fields', intake ? { version: intake.version, fields: intake.fields, createdAt: intake.createdAt } : null);
  }

  const plan = await activePlanFor(ctx, caseKey);
  if (plan) {
    const content = plan.content as PlanContent;
    const hidden = new Set(HIDE_SECTIONS_FOR[role]);
    for (const key of Object.keys(content) as Array<keyof PlanContent>) {
      if (hidden.has(key)) continue;
      include(`plan.${key}` as CaseField, content[key]);
    }
    include('plan.status', plan.status);
    const [approver] = plan.approvedBy ? await ctx.db.select({ name: users.displayName }).from(users).where(eq(users.id, plan.approvedBy)).limit(1) : [];
    include('plan.provenance', {
      aiDrafted: true,
      promptVersionId: plan.promptVersionId,
      approvedBy: approver?.name ?? null,
      approvedAt: plan.approvedAt,
      version: plan.version,
      transitions: canSee('plan.draftDiff', role) ? (plan.transitions as PlanTransitionRecord[]) : undefined,
    });
    include('plan.draftDiff', plan.draftDiff);

    const g = await ctx.db.select().from(goals).where(eq(goals.planId, plan.id)).orderBy(goals.sortOrder);
    const goalViews = [];
    for (const goal of g) {
      const gv: Record<string, unknown> = goalForRole(goal, role);
      if (canSee('goal.progressSeries', role) || canSee('goal.progressSummary', role)) {
        const progress = await progressForGoal(ctx, goal.id);
        if (progress) {
          if (canSee('goal.progressSeries', role)) gv.progress = progress;
          else gv.progressSummary = { totalObservations: progress.totalObservations, preBaseline: progress.preBaseline, lastEntry: progress.points.at(-1)?.date ?? null };
          if (canSee('goal.accomplishments', role)) gv.accomplishments = accomplishments(progress);
        }
      }
      goalViews.push(gv);
    }
    if (canSee('goal.definition', role)) {
      view.fields.push('goal.definition');
      view.goals = goalViews;
    }

    const s = await ctx.db.select().from(strategies).where(and(eq(strategies.planId, plan.id), eq(strategies.status, 'active'))).orderBy(strategies.sortOrder);
    const allowedKinds = role === 'student' ? ['self_monitor', 'replacement'] : role === 'guardian' ? ['family', 'replacement', 'self_monitor'] : ['preventive', 'response', 'replacement', 'self_monitor', 'family'];
    view.strategies = s.filter((x) => allowedKinds.includes(x.kind)).map((x) => ({ id: x.id, kind: x.kind, ...(x.content as StrategyContent) }));

    const rc = await ctx.db.select().from(reviewCycles).where(eq(reviewCycles.planId, plan.id)).orderBy(desc(reviewCycles.dueAt));
    view.reviewCycles = rc.map((cycle) => {
      const n = cycle.narrative as ReviewNarrative | null;
      const out: Record<string, unknown> = { id: cycle.id, dueAt: cycle.dueAt, status: cycle.status };
      if (canSee('review.decision', role)) {
        out.decision = cycle.decision;
        out.decidedAt = cycle.decidedAt;
      }
      if (canSee('review.computed', role)) {
        out.computed = cycle.computed as ComputedRecommendation | null;
        out.rationale = cycle.rationale;
        out.narrativeStatus = cycle.narrativeStatus;
      }
      if (canSee('review.narrativeTeacher', role) && n) out.narrativeTeacher = { summary: n.summaryForTeacher, suggestedAdjustments: n.suggestedAdjustments, humanReviewNotes: n.humanReviewNotes };
      if (canSee('review.narrativeStudent', role) && n && cycle.status === 'decided') out.narrativeStudent = n.summaryForStudent;
      if (canSee('review.narrativeFamily', role) && n && cycle.status === 'decided') out.narrativeFamily = n.summaryForFamily;
      return out;
    });
    view.planId = plan.id;
  }

  if (canSee('signal.behaviorEvents', role)) {
    const recent = await recentSignals(ctx, caseKey, 100);
    include('signal.behaviorEvents', recent.filter((x) => x.type === 'behavior_event' || x.type === 'interval_observation').map(({ note: _n, ...rest }) => rest));
    include('signal.behaviorEventNotes', recent.filter((x) => x.note).map((x) => ({ id: x.id, observedAt: x.observedAt, note: x.note })));
    include('signal.grades', recent.filter((x) => x.type === 'assignment_grade' || x.type === 'assessment_score'));
    include('signal.attendance', recent.filter((x) => x.type === 'attendance'));
  }
  if (canSee('signal.strategyUse', role)) include('signal.strategyUse', (await recentSignals(ctx, caseKey, 100)).filter((x) => x.type === 'strategy_use').map(({ note: _n, ...r }) => r));
  if (canSee('signal.selfChecks', role)) include('signal.selfChecks', (await recentSignals(ctx, caseKey, 100)).filter((x) => x.type === 'self_check').map(({ note: _n, ...r }) => r));

  if (canSee('pattern.candidates', role)) {
    const rows = await ctx.db.select().from(patternCandidates).where(and(eq(patternCandidates.caseKey, caseKey), eq(patternCandidates.visible, true))).orderBy(desc(patternCandidates.detectedAt));
    include('pattern.candidates', rows.map((r) => ({ id: r.id, definitionId: r.definitionId, title: r.title, status: r.status, strength: r.strength, routing: r.routing, detectedAt: r.detectedAt, proposalStatus: r.proposalStatus })));
  } else if (canSee('pattern.confirmedPlainLanguage', role)) {
    // Guardians: confirmed patterns only, in plain language, with the evidence shown (open question #9).
    const rows = await ctx.db.select().from(patternCandidates).where(and(eq(patternCandidates.caseKey, caseKey), eq(patternCandidates.status, 'confirmed'))).orderBy(desc(patternCandidates.adjudicatedAt));
    include('pattern.confirmedPlainLanguage', rows.map((r) => ({ id: r.id, title: r.title, plainLanguage: r.plainLanguage, confirmedAt: r.adjudicatedAt, evidence: canSee('pattern.evidence', role) ? { observations: r.evidenceRefs.length, measures: r.measures } : undefined })));
  }

  if (canSee('safety.flags', role)) include('safety.flags', await listSafetyFlags(ctx, caseKey));

  if (role === 'guardian') {
    view.correctionRequests = await ctx.db.select().from(correctionRequests).where(eq(correctionRequests.caseKey, caseKey)).orderBy(desc(correctionRequests.createdAt));
    view.dataCollectedExplanation = DATA_EXPLANATION;
  }

  const student = role === 'student' ? null : await studentForCase(ctx.db, actor, caseKey);
  if (student) view.student = student;
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'student.read', targetType: 'case', targetId: caseKey, caseKey, studentId: student?.id ?? null, metadata: { fields: view.fields.length } });
  return view;
}

function accomplishments(progress: NonNullable<Awaited<ReturnType<typeof progressForGoal>>>): string[] {
  const out: string[] = [];
  const pts = progress.points;
  if (pts.length >= 5) out.push(`${pts.length} days of progress recorded`);
  if (progress.baseline.status === 'available' && pts.length >= 3) {
    const recent = pts.slice(-3).reduce((s, p) => s + p.value, 0) / 3;
    const better = progress.direction === 'decrease' ? recent < progress.baseline.value : recent > progress.baseline.value;
    if (better) out.push('Recent days are better than the starting point');
  }
  if (progress.selfChecks.filter((s) => s.value >= 3).length >= 3) out.push('Three or more self-checks rated "yes"');
  return out;
}

export const DATA_EXPLANATION = {
  whatIsCollected: [
    'Counts of specific, observable classroom behaviors that the plan names, entered by the teacher.',
    'Which support strategies were used, and when.',
    'Grades, assessment scores and attendance already recorded by the school, when a teacher chooses to include them.',
    'Short self-check ratings your child enters.',
  ],
  why: 'To see whether the plan is helping, to notice patterns a busy teacher might miss, and to decide together when to change course.',
  whatIsNotCollected: ['Names, ids or dates of birth are never sent to the AI service; the plan is drafted from de-identified descriptions.', 'No diagnosis, disability determination or disciplinary decision is made by this tool.'],
  aiRole: 'An AI service drafts the plan and suggests ideas. A named educator reviews and approves every plan and every suggestion before it applies to your child.',
};
