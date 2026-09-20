import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  DismissalReason,
  canTransitionCandidate,
  newId,
  type CandidateStatus,
  type GoalContent,
  type PatternDefinitionStatus,
  type PatternRouting,
  type StrategyContent,
} from '@class-pulse/domain';
import { interpretPattern } from '@class-pulse/ai';
import { PATTERN_CATALOG, applyTeacherCap, definitionById, summarizeEvidence, sweepCase, type DetectionContext, type PlanContext, type ReviewCycleContext } from '@class-pulse/patterns';
import { canAdjudicate } from '@class-pulse/policy';
import type { Actor, AppContext } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import { cases, definitionStatus, goals, insufficientDataNotes, patternCandidates, reviewCycles, strategies } from '../db/schema';
import { audit } from './audit';
import { roleForCase } from './cases';
import { addGoal, addStrategy, activePlanFor } from './plans';
import { activePrompts } from './prompts';
import { recordRuns } from './ai';
import { denyNamesForCase } from './roster';
import { signalsForCase } from './signals';

export async function statusOverrides(ctx: AppContext): Promise<Map<string, PatternDefinitionStatus>> {
  const rows = await ctx.db.select().from(definitionStatus);
  return new Map(rows.map((r) => [r.definitionId, r.status as PatternDefinitionStatus]));
}

export async function detectionContextFor(ctx: AppContext, caseKey: string): Promise<DetectionContext> {
  const window = await signalsForCase(ctx, caseKey, 120);
  const plan = await activePlanFor(ctx, caseKey);
  let planCtx: PlanContext | null = null;
  const cycles: ReviewCycleContext[] = [];
  if (plan && plan.status === 'active') {
    const g = await ctx.db.select().from(goals).where(eq(goals.planId, plan.id));
    const s = await ctx.db.select().from(strategies).where(eq(strategies.planId, plan.id));
    const content = plan.content as { studentStrengths: string[] };
    planCtx = {
      strengths: content.studentStrengths,
      strategies: s.map((x) => ({ id: x.id, kind: x.kind as never, description: (x.content as StrategyContent).description, usesStrengths: (x.content as StrategyContent).usesStrengths, status: x.status as never })),
      goals: g.map((x) => ({ id: x.id, status: x.status, ...(x.content as GoalContent) })),
    };
    const rc = await ctx.db.select().from(reviewCycles).where(eq(reviewCycles.planId, plan.id)).orderBy(reviewCycles.dueAt);
    for (const c of rc) cycles.push({ decision: (c.decision as never) ?? null, decidedAt: c.decidedAt, computed: (c.computed as never) ?? null });
  }
  const now = ctx.now();
  return { window: { caseKey, from: new Date(now.getTime() - 120 * 86_400_000), to: now, signals: window }, plan: planCtx, reviewCycles: cycles, now };
}

/**
 * Sweep one case (docs/05 "Pattern sweep"): run the catalog, apply suppression and the
 * per-teacher cap, persist candidates + insufficient-data notes, and enqueue interpretation for
 * visible candidates that route to a human queue. Piloting candidates are recorded, invisible.
 */
export async function sweepOneCase(ctx: AppContext, caseKey: string, opts: { capPerTeacher?: number } = {}) {
  const [c] = await ctx.db.select().from(cases).where(eq(cases.caseKey, caseKey)).limit(1);
  if (!c || c.status !== 'open') return { created: 0, insufficient: 0 };
  const existing = await ctx.db.select().from(patternCandidates).where(eq(patternCandidates.caseKey, caseKey));
  const detection = await detectionContextFor(ctx, caseKey);
  const outcome = sweepCase(detection, {
    definitions: PATTERN_CATALOG,
    statusOverrides: await statusOverrides(ctx),
    existing: existing.map((e) => ({ definitionId: e.definitionId, status: e.status as CandidateStatus, detectedAt: e.detectedAt, adjudicatedAt: e.adjudicatedAt })),
  });

  // Replace insufficient-data notes for this case with the latest set.
  await ctx.db.delete(insufficientDataNotes).where(eq(insufficientDataNotes.caseKey, caseKey));
  for (const n of outcome.insufficient) {
    await ctx.db.insert(insufficientDataNotes).values({ id: newId(), caseKey, definitionId: n.definitionId, definitionVersion: n.version, title: n.title, missing: n.missing, at: ctx.now() });
  }

  // Per-teacher cap across the section (docs/02: start at 3, rank by strength).
  const sectionCases = await ctx.db.select({ caseKey: cases.caseKey }).from(cases).where(eq(cases.sectionId, c.sectionId));
  const visibleActive = await ctx.db
    .select({ id: patternCandidates.id })
    .from(patternCandidates)
    .where(and(inArray(patternCandidates.caseKey, sectionCases.map((x) => x.caseKey)), eq(patternCandidates.visible, true), inArray(patternCandidates.status, ['detected', 'in_review'])));
  const cap = opts.capPerTeacher ?? ctx.config.patternMaxActivePerTeacher;
  const visibleNew = outcome.candidates.filter((x) => x.visible).map((x) => ({ strength: x.result.strength, cand: x }));
  const { surface, hold } = applyTeacherCap(visibleNew, visibleActive.length, cap);
  const surfaced = new Set(surface.map((s) => s.cand));
  void hold;

  let created = 0;
  for (const cand of outcome.candidates) {
    const id = newId();
    const visible = cand.visible && surfaced.has(cand);
    await ctx.db.insert(patternCandidates).values({
      id,
      caseKey,
      definitionId: cand.definition.id,
      definitionVersion: cand.definition.version,
      title: cand.definition.title,
      plainLanguage: cand.definition.plainLanguage,
      confounders: cand.definition.confounders,
      status: 'detected',
      strength: cand.result.strength,
      evidenceRefs: cand.result.evidenceRefs,
      measures: cand.result.measures,
      routing: cand.definition.routing,
      proposalStatus: visible && cand.definition.routing !== 'safety_escalation' ? 'pending' : 'none',
      visible,
      detectedAt: ctx.now(),
    });
    created++;
    if (visible && cand.definition.routing !== 'safety_escalation') await ctx.queue.enqueue('interpret_candidate', { candidateId: id, caseKey });
  }
  return { created, insufficient: outcome.insufficient.length, suppressed: outcome.suppressed.length };
}

export async function sweepAllCases(ctx: AppContext) {
  const rows = await ctx.db.select({ caseKey: cases.caseKey }).from(cases).where(eq(cases.status, 'open'));
  let created = 0;
  for (const r of rows) created += (await sweepOneCase(ctx, r.caseKey)).created;
  return { cases: rows.length, created };
}

/** Interpretation job: build the de-identified payload (docs/02 §2) and persist the proposal. */
export async function interpretCandidate(ctx: AppContext, candidateId: string) {
  const [cand] = await ctx.db.select().from(patternCandidates).where(eq(patternCandidates.id, candidateId)).limit(1);
  if (!cand) return;
  const def = definitionById(cand.definitionId);
  if (!def) return;
  const detection = await detectionContextFor(ctx, cand.caseKey);
  const [c] = await ctx.db.select().from(cases).where(eq(cases.caseKey, cand.caseKey)).limit(1);
  const prompts = await activePrompts(ctx.db);
  const result = await interpretPattern(
    { gate: ctx.gate, prompts, caseKey: cand.caseKey, denyNames: await denyNamesForCase(ctx.db, cand.caseKey) },
    {
      definition: { id: def.id, version: def.version, title: def.title, plainLanguage: def.plainLanguage },
      measures: cand.measures,
      evidence: summarizeEvidence(detection.window.signals, cand.evidenceRefs),
      confounders: cand.confounders,
      strengths: detection.plan?.strengths ?? [],
      activeStrategies: (detection.plan?.strategies ?? []).filter((s) => s.status === 'active').map((s) => ({ kind: s.kind, description: s.description })),
      routing: cand.routing as PatternRouting,
      gradeLevel: c?.gradeLevel ?? 'unknown',
    },
  );
  const runs = 'runs' in result ? result.runs : [];
  if (result.status === 'succeeded' || result.status === 'rejected') {
    await recordRuns(ctx.db, 'pattern_interpretation', cand.caseKey, runs, result.status === 'succeeded' ? 'succeeded' : 'rejected');
    await ctx.db
      .update(patternCandidates)
      .set({ proposal: result.output, proposalGuardrails: result.guardrails, proposalStatus: result.status === 'succeeded' ? 'ready' : 'needs_attention', proposalRunId: runs.at(-1)?.runId ?? null })
      .where(eq(patternCandidates.id, candidateId));
  } else {
    await recordRuns(ctx.db, 'pattern_interpretation', cand.caseKey, runs, result.status === 'blocked_pii' ? 'blocked_pii' : 'failed', result.status === 'failed' ? result.error : null);
    await ctx.db.update(patternCandidates).set({ proposalStatus: 'failed' }).where(eq(patternCandidates.id, candidateId));
    if (result.status === 'failed') throw new Error(result.error);
  }
}

// ---- Queues and adjudication ----------------------------------------------------------------

export async function candidatesForActor(ctx: AppContext, actor: Actor, queue: 'teacher' | 'support') {
  const keys = [...actor.scope.caseRoles.keys()];
  if (!keys.length) return [];
  const routing = queue === 'support' ? ['support_team', 'safety_escalation'] : ['teacher_review'];
  const rows = await ctx.db
    .select()
    .from(patternCandidates)
    .where(and(inArray(patternCandidates.caseKey, keys), eq(patternCandidates.visible, true), inArray(patternCandidates.routing, routing)))
    .orderBy(desc(patternCandidates.strength), desc(patternCandidates.detectedAt));
  return rows.filter((r) => canAdjudicate(actor.scope.caseRoles.get(r.caseKey)!, r.routing as PatternRouting) || r.status !== 'detected');
}

export async function candidatesForCase(ctx: AppContext, actor: Actor, caseKey: string, includeInvisible = false) {
  const role = roleForCase(actor, caseKey);
  const teacherLike = role === 'teacher' || role === 'support_professional' || role === 'administrator_authorized';
  const rows = await ctx.db.select().from(patternCandidates).where(eq(patternCandidates.caseKey, caseKey)).orderBy(desc(patternCandidates.detectedAt));
  return rows.filter((r) => (teacherLike ? includeInvisible || r.visible : r.status === 'confirmed'));
}

export async function getCandidate(ctx: AppContext, actor: Actor, id: string) {
  const [cand] = await ctx.db.select().from(patternCandidates).where(eq(patternCandidates.id, id)).limit(1);
  if (!cand) throw notFound('Candidate not found');
  roleForCase(actor, cand.caseKey);
  return cand;
}

export async function openCandidate(ctx: AppContext, actor: Actor, id: string) {
  const cand = await getCandidate(ctx, actor, id);
  const role = roleForCase(actor, cand.caseKey);
  if (!canAdjudicate(role, cand.routing as PatternRouting)) throw forbidden(`Role ${role} cannot review ${cand.routing} candidates`);
  if (cand.status === 'detected' || cand.status === 'needs_more_data' || cand.status === 'escalated') {
    if (!canTransitionCandidate(cand.status as CandidateStatus, 'in_review')) throw conflict(`Cannot open a ${cand.status} candidate`);
    await ctx.db.update(patternCandidates).set({ status: 'in_review' }).where(eq(patternCandidates.id, id));
  }
  return { ...cand, status: 'in_review' as const };
}

export interface AdjudicationInput {
  decision: 'confirmed' | 'dismissed' | 'needs_more_data' | 'escalated';
  note?: string | null;
  dismissalReason?: string | null;
  collectionTarget?: { signalType: string; additionalObservations: number } | null;
  /** On confirmation: the educator-edited goal or strategy to seed (docs/02 §3). */
  seed?: { kind: 'goal'; content: unknown } | { kind: 'strategy'; strategyKind: string; content: unknown } | null;
}

/** docs/02 §3: detected → in_review → confirmed | dismissed | needs_more_data | escalated */
export async function adjudicate(ctx: AppContext, actor: Actor, id: string, input: AdjudicationInput) {
  const cand = await getCandidate(ctx, actor, id);
  const role = roleForCase(actor, cand.caseKey);
  if (!canAdjudicate(role, cand.routing as PatternRouting)) throw forbidden(`Role ${role} cannot adjudicate ${cand.routing} candidates`);
  const from = cand.status as CandidateStatus;
  const via: CandidateStatus = from === 'in_review' ? 'in_review' : 'in_review';
  if (from !== 'in_review' && !canTransitionCandidate(from, 'in_review')) throw conflict(`Candidate is ${from}`);
  if (!canTransitionCandidate(via, input.decision)) throw conflict(`Cannot ${input.decision} from ${via}`);
  if (input.decision === 'dismissed' && !input.dismissalReason) throw badRequest('Dismissal requires a reason code');
  if (input.decision === 'dismissed') DismissalReason.parse(input.dismissalReason);
  if (input.decision === 'needs_more_data' && !input.collectionTarget) throw badRequest('needs_more_data requires a collection target');
  if (input.decision === 'escalated' && cand.routing === 'safety_escalation') throw badRequest('Safety-escalation candidates follow the school procedure; record acknowledgement instead');

  let resultingGoalId: string | null = null;
  let resultingStrategyId: string | null = null;
  if (input.decision === 'confirmed' && input.seed) {
    const plan = await activePlanFor(ctx, cand.caseKey);
    if (!plan || plan.status !== 'active') throw conflict('No active plan to seed; approve a plan first');
    const origin = { fromCandidateId: id, definitionId: cand.definitionId };
    if (input.seed.kind === 'goal') resultingGoalId = await addGoal(ctx, actor, plan.id, input.seed.content, origin);
    else resultingStrategyId = await addStrategy(ctx, actor, plan.id, input.seed.strategyKind as never, input.seed.content, origin);
  }
  await ctx.db
    .update(patternCandidates)
    .set({
      status: input.decision,
      adjudicatedBy: actor.userId,
      adjudicatedAt: ctx.now(),
      adjudicationNote: input.note ?? null,
      dismissalReason: input.decision === 'dismissed' ? input.dismissalReason ?? null : null,
      collectionTarget: input.decision === 'needs_more_data' ? input.collectionTarget ?? null : null,
      resultingGoalId,
      resultingStrategyId,
    })
    .where(eq(patternCandidates.id, id));
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'candidate.adjudicate', targetType: 'pattern_candidate', targetId: id, caseKey: cand.caseKey, metadata: { decision: input.decision, dismissalReason: input.dismissalReason ?? null, definitionId: cand.definitionId, resultingGoalId, resultingStrategyId } });
  return { resultingGoalId, resultingStrategyId };
}

/** Re-evaluate a needs_more_data candidate once its collection target is reached (docs/02 §3). */
export async function reevaluateNeedsMoreData(ctx: AppContext, caseKey: string) {
  const rows = await ctx.db.select().from(patternCandidates).where(and(eq(patternCandidates.caseKey, caseKey), eq(patternCandidates.status, 'needs_more_data')));
  if (!rows.length) return;
  const all = await signalsForCase(ctx, caseKey, 120);
  for (const r of rows) {
    const target = r.collectionTarget as { signalType: string; additionalObservations: number } | null;
    if (!target || !r.adjudicatedAt) continue;
    const since = all.filter((s) => s.type === target.signalType && s.observedAt > r.adjudicatedAt!).length;
    if (since >= target.additionalObservations) {
      await ctx.db.update(patternCandidates).set({ status: 'in_review', proposalStatus: 'pending' }).where(eq(patternCandidates.id, r.id));
      await ctx.queue.enqueue('interpret_candidate', { candidateId: r.id, caseKey });
    }
  }
}

export async function setDefinitionStatus(ctx: AppContext, actor: Actor, definitionId: string, status: PatternDefinitionStatus, reviewer: string | null) {
  if (!actor.roles.has('administrator')) throw forbidden('Only administrators change definition status');
  const def = definitionById(definitionId);
  if (!def) throw notFound('Unknown definition');
  if (status === 'active' && !reviewer) throw badRequest('A named reviewer is required before a definition leaves piloting (open question #10)');
  await ctx.db
    .insert(definitionStatus)
    .values({ definitionId, version: def.version, status, reviewer, updatedBy: actor.userId, updatedAt: ctx.now() })
    .onConflictDoUpdate({ target: definitionStatus.definitionId, set: { status, reviewer, updatedBy: actor.userId, updatedAt: ctx.now(), version: def.version } });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'administrator', action: 'definition.status', targetType: 'pattern_definition', targetId: definitionId, metadata: { status, reviewer } });
}
