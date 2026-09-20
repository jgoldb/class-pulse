import { and, asc, desc, eq } from 'drizzle-orm';
import {
  GoalContent,
  PlanContent,
  StrategyContent,
  StrategyKind,
  canTransitionPlan,
  diffPlans,
  isApprovalTransition,
  newId,
  summarizeDiffBySection,
  type PlanStatus,
  type PlanTransitionRecord,
} from '@class-pulse/domain';
import { checkEditedPlan } from '@class-pulse/ai';
import { canApprovePlan } from '@class-pulse/policy';
import type { Actor, AppContext } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import { goals, planDrafts, plans, reviewCycles, strategies } from '../db/schema';
import { audit } from './audit';
import { requireTeacherLike, roleForCase } from './cases';

const STRATEGY_SECTIONS: Array<[keyof PlanContent, StrategyKind]> = [
  ['preventiveStrategies', 'preventive'],
  ['teacherResponseStrategies', 'response'],
  ['studentSelfMonitoring', 'self_monitor'],
  ['parentGuardianSupport', 'family'],
];

export async function getDraft(ctx: AppContext, actor: Actor, draftId: string) {
  const [d] = await ctx.db.select().from(planDrafts).where(eq(planDrafts.id, draftId)).limit(1);
  if (!d) throw notFound('Draft not found');
  requireTeacherLike(actor, d.caseKey);
  return d;
}

export async function listDrafts(ctx: AppContext, actor: Actor, caseKey: string) {
  requireTeacherLike(actor, caseKey);
  return ctx.db.select().from(planDrafts).where(eq(planDrafts.caseKey, caseKey)).orderBy(desc(planDrafts.createdAt));
}

/**
 * Approval (docs/06 Phase 2): section-by-section edits arrive as the full edited content. We
 * re-run deterministic guardrails on the edited text (an edit can reintroduce a V1 failure),
 * store the draft→approved diff, materialize goals and strategies as live objects, schedule the
 * first review cycle, and record the transition with the named reviewer.
 */
export async function approveDraft(ctx: AppContext, actor: Actor, draftId: string, edited: unknown, rationale: string | null) {
  const draft = await getDraft(ctx, actor, draftId);
  const role = roleForCase(actor, draft.caseKey);
  if (!canApprovePlan(role, ctx.config.planApproverRoles)) throw forbidden(`Role ${role} may not approve plans (PLAN_APPROVER_ROLES)`);
  if (!['ready', 'needs_attention'].includes(draft.status)) throw conflict(`Draft is ${draft.status}; only ready or needs_attention drafts can be approved`);
  if (!draft.content) throw conflict('Draft has no content');
  const content = PlanContent.parse(edited);
  const guardrails = checkEditedPlan(content);
  if (!guardrails.passed) throw badRequest('The edited plan fails deterministic guardrails', { findings: guardrails.findings });
  if (content.privacyAndHumanReviewNotes.safetyConcern && !rationale) {
    throw badRequest('This draft carries a safety concern. Confirm in the rationale that school safety procedures have been followed.');
  }

  const diff = diffPlans(draft.content, content);
  const [existing] = await ctx.db.select().from(plans).where(and(eq(plans.caseKey, draft.caseKey), eq(plans.status, 'active'))).limit(1);
  const planId = newId();
  const now = ctx.now();
  const transitions: PlanTransitionRecord[] = [
    { from: 'draft', to: 'in_review', actorUserId: actor.userId, at: now, rationale: null },
    { from: 'in_review', to: 'active', actorUserId: actor.userId, at: now, rationale },
  ];
  await ctx.db.transaction(async (tx) => {
    if (existing) {
      await tx.update(plans).set({ status: 'modified', updatedAt: now, transitions: [...(existing.transitions as PlanTransitionRecord[]), { from: existing.status as PlanStatus, to: 'modified', actorUserId: actor.userId, at: now, rationale: 'Superseded by a new approved plan' }] }).where(eq(plans.id, existing.id));
      await tx.update(goals).set({ status: 'modified' }).where(and(eq(goals.planId, existing.id), eq(goals.status, 'active')));
      await tx.update(strategies).set({ status: 'retired' }).where(eq(strategies.planId, existing.id));
      await tx.update(reviewCycles).set({ status: 'skipped' }).where(and(eq(reviewCycles.planId, existing.id), eq(reviewCycles.status, 'scheduled')));
    }
    await tx.insert(plans).values({
      id: planId,
      caseKey: draft.caseKey,
      draftId,
      content,
      status: 'active',
      version: (existing?.version ?? 0) + 1,
      promptVersionId: null,
      createdBy: actor.userId,
      approvedBy: actor.userId,
      approvedAt: now,
      draftDiff: { entries: diff, bySection: summarizeDiffBySection(diff) },
      transitions,
      createdAt: now,
      updatedAt: now,
    });
    for (const [i, g] of content.measurableGoals.entries()) {
      await tx.insert(goals).values({ id: newId(), planId, caseKey: draft.caseKey, content: g, status: 'active', sortOrder: i });
    }
    let order = 0;
    for (const [section, kind] of STRATEGY_SECTIONS) {
      for (const s of content[section] as StrategyContent[]) {
        await tx.insert(strategies).values({ id: newId(), planId, caseKey: draft.caseKey, kind, content: s, status: 'active', sortOrder: order++ });
      }
    }
    for (const r of content.replacementBehaviors) {
      await tx.insert(strategies).values({ id: newId(), planId, caseKey: draft.caseKey, kind: 'replacement', content: { description: r.behavior, rationale: r.howToTeach, usesStrengths: [], effortLevel: 'low' }, status: 'active', sortOrder: order++ });
    }
    const reviewDays = Math.min(...content.measurableGoals.map((g) => g.reviewPeriodDays), 30);
    await tx.insert(reviewCycles).values({ id: newId(), planId, caseKey: draft.caseKey, dueAt: new Date(now.getTime() + reviewDays * 86_400_000), status: 'scheduled' });
    await tx.update(planDrafts).set({ status: 'approved', updatedAt: now }).where(eq(planDrafts.id, draftId));
  });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'plan.approve', targetType: 'plan', targetId: planId, caseKey: draft.caseKey, metadata: { draftId, diffSections: summarizeDiffBySection(diff), rationale } });
  // The plan's own strengths section enters the live loop immediately (strength-underutilization).
  await ctx.queue.enqueue('sweep_case', { caseKey: draft.caseKey }, { dedupeKey: draft.caseKey });
  return { planId };
}

export async function discardDraft(ctx: AppContext, actor: Actor, draftId: string) {
  const draft = await getDraft(ctx, actor, draftId);
  await ctx.db.update(planDrafts).set({ status: 'discarded', updatedAt: ctx.now() }).where(eq(planDrafts.id, draftId));
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: roleForCase(actor, draft.caseKey), action: 'plan.transition', targetType: 'plan_draft', targetId: draftId, caseKey: draft.caseKey, metadata: { to: 'discarded' } });
}

export async function activePlanFor(ctx: AppContext, caseKey: string) {
  const [p] = await ctx.db
    .select()
    .from(plans)
    .where(and(eq(plans.caseKey, caseKey), eq(plans.status, 'active')))
    .orderBy(desc(plans.version))
    .limit(1);
  if (p) return p;
  const [any] = await ctx.db.select().from(plans).where(eq(plans.caseKey, caseKey)).orderBy(desc(plans.version)).limit(1);
  return any ?? null;
}

export async function planWithChildren(ctx: AppContext, planId: string) {
  const [p] = await ctx.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!p) throw notFound('Plan not found');
  const g = await ctx.db.select().from(goals).where(eq(goals.planId, planId)).orderBy(asc(goals.sortOrder));
  const s = await ctx.db.select().from(strategies).where(eq(strategies.planId, planId)).orderBy(asc(strategies.sortOrder));
  const r = await ctx.db.select().from(reviewCycles).where(eq(reviewCycles.planId, planId)).orderBy(asc(reviewCycles.dueAt));
  return { plan: p, goals: g, strategies: s, reviewCycles: r };
}

/** Plan lifecycle transitions other than approval (docs/01 state machine). */
export async function transitionPlan(ctx: AppContext, actor: Actor, planId: string, to: PlanStatus, rationale: string | null) {
  const [p] = await ctx.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!p) throw notFound('Plan not found');
  const role = requireTeacherLike(actor, p.caseKey);
  const from = p.status as PlanStatus;
  if (!canTransitionPlan(from, to)) throw conflict(`Cannot move a plan from ${from} to ${to}`);
  if (isApprovalTransition(from, to) && !canApprovePlan(role, ctx.config.planApproverRoles)) throw forbidden(`Role ${role} may not make approval transitions`);
  const now = ctx.now();
  const record: PlanTransitionRecord = { from, to, actorUserId: actor.userId, at: now, rationale };
  await ctx.db.transaction(async (tx) => {
    await tx.update(plans).set({ status: to, updatedAt: now, transitions: [...(p.transitions as PlanTransitionRecord[]), record] }).where(eq(plans.id, planId));
    if (to === 'faded' || to === 'discontinued') {
      await tx.update(goals).set({ status: to }).where(and(eq(goals.planId, planId), eq(goals.status, 'active')));
      await tx.update(strategies).set({ status: 'retired' }).where(eq(strategies.planId, planId));
      await tx.update(reviewCycles).set({ status: 'skipped' }).where(and(eq(reviewCycles.planId, planId), eq(reviewCycles.status, 'scheduled')));
    }
    // continued/modified return the plan to active service
    if (to === 'continued' || to === 'modified') {
      await tx.update(plans).set({ status: 'active', transitions: [...(p.transitions as PlanTransitionRecord[]), record, { from: to, to: 'active', actorUserId: actor.userId, at: now, rationale: null }] }).where(eq(plans.id, planId));
    }
  });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'plan.transition', targetType: 'plan', targetId: planId, caseKey: p.caseKey, metadata: { from, to, rationale } });
}

export async function updateGoal(ctx: AppContext, actor: Actor, goalId: string, input: { content?: unknown; status?: string }) {
  const [g] = await ctx.db.select().from(goals).where(eq(goals.id, goalId)).limit(1);
  if (!g) throw notFound('Goal not found');
  const role = requireTeacherLike(actor, g.caseKey);
  const patch: Partial<typeof goals.$inferInsert> = {};
  if (input.content !== undefined) {
    const content = GoalContent.parse(input.content);
    // Establishing a target is a human act: only allowed with an available baseline.
    if (content.target.status !== 'blocked_on_baseline' && content.baseline.status !== 'available') throw badRequest('A numeric target requires an available baseline');
    if (content.target.status === 'established') content.target = { ...content.target, establishedBy: actor.userId };
    patch.content = content;
  }
  if (input.status) patch.status = input.status;
  await ctx.db.update(goals).set(patch).where(eq(goals.id, goalId));
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'plan.transition', targetType: 'goal', targetId: goalId, caseKey: g.caseKey, metadata: { status: input.status ?? null, edited: input.content !== undefined } });
}

export async function addGoal(ctx: AppContext, actor: Actor, planId: string, content: unknown, origin: Record<string, unknown> = {}) {
  const [p] = await ctx.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!p) throw notFound('Plan not found');
  const role = requireTeacherLike(actor, p.caseKey);
  const parsed = GoalContent.parse(content);
  if (parsed.target.status !== 'blocked_on_baseline' && parsed.baseline.status !== 'available') throw badRequest('A numeric target requires an available baseline');
  const [last] = await ctx.db.select().from(goals).where(eq(goals.planId, planId)).orderBy(desc(goals.sortOrder)).limit(1);
  const id = newId();
  await ctx.db.insert(goals).values({ id, planId, caseKey: p.caseKey, content: parsed, status: 'active', sortOrder: (last?.sortOrder ?? -1) + 1 });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'plan.transition', targetType: 'goal', targetId: id, caseKey: p.caseKey, metadata: { added: true, ...origin } });
  return id;
}

export async function addStrategy(ctx: AppContext, actor: Actor, planId: string, kind: StrategyKind, content: unknown, origin: Record<string, unknown> = {}) {
  const [p] = await ctx.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!p) throw notFound('Plan not found');
  const role = requireTeacherLike(actor, p.caseKey);
  const parsed = StrategyContent.parse(content);
  StrategyKind.parse(kind);
  const [last] = await ctx.db.select().from(strategies).where(eq(strategies.planId, planId)).orderBy(desc(strategies.sortOrder)).limit(1);
  const id = newId();
  await ctx.db.insert(strategies).values({ id, planId, caseKey: p.caseKey, kind, content: parsed, status: 'active', sortOrder: (last?.sortOrder ?? -1) + 1 });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'plan.transition', targetType: 'strategy', targetId: id, caseKey: p.caseKey, metadata: { added: true, kind, ...origin } });
  await ctx.queue.enqueue('sweep_case', { caseKey: p.caseKey }, { dedupeKey: p.caseKey });
  return id;
}

export async function updateStrategy(ctx: AppContext, actor: Actor, strategyId: string, input: { content?: unknown; status?: 'active' | 'retired' }) {
  const [s] = await ctx.db.select().from(strategies).where(eq(strategies.id, strategyId)).limit(1);
  if (!s) throw notFound('Strategy not found');
  const role = requireTeacherLike(actor, s.caseKey);
  const patch: Partial<typeof strategies.$inferInsert> = {};
  if (input.content !== undefined) patch.content = StrategyContent.parse(input.content);
  if (input.status) patch.status = input.status;
  await ctx.db.update(strategies).set(patch).where(eq(strategies.id, strategyId));
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'plan.transition', targetType: 'strategy', targetId: strategyId, caseKey: s.caseKey, metadata: { status: input.status ?? null } });
}
