import { and, eq, lte } from 'drizzle-orm';
import { ReviewDecision, newId, type ComputedRecommendation, type GoalContent, type PlanContent, type PlanStatus, type PlanTransitionRecord } from '@class-pulse/domain';
import { narrateReview } from '@class-pulse/ai';
import { computeRecommendation } from '@class-pulse/patterns';
import { canApprovePlan } from '@class-pulse/policy';
import type { Actor, AppContext } from '../context';
import { conflict, forbidden, notFound } from '../context';
import { goals, plans, reviewCycles } from '../db/schema';
import { audit } from './audit';
import { requireTeacherLike, roleForCase } from './cases';
import { activePrompts } from './prompts';
import { recordRuns } from './ai';
import { denyNamesForCase } from './roster';
import { signalsForCase } from './signals';

/**
 * Review-cycle engine (docs/05): a cycle coming due runs the plan's section-14 rules over the
 * signal store, stores the computed recommendation, and enqueues narration. The decision is
 * always the reviewer's.
 */
export async function openDueReviews(ctx: AppContext) {
  const due = await ctx.db.select().from(reviewCycles).where(and(eq(reviewCycles.status, 'scheduled'), lte(reviewCycles.dueAt, ctx.now())));
  for (const cycle of due) await openReview(ctx, cycle.id);
  return due.length;
}

export async function openReview(ctx: AppContext, cycleId: string) {
  const [cycle] = await ctx.db.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId)).limit(1);
  if (!cycle) return;
  const [plan] = await ctx.db.select().from(plans).where(eq(plans.id, cycle.planId)).limit(1);
  if (!plan || plan.status !== 'active') return;
  const content = plan.content as PlanContent;
  const g = await ctx.db.select().from(goals).where(and(eq(goals.planId, plan.id), eq(goals.status, 'active'))).orderBy(goals.sortOrder);
  const computed = computeRecommendation({
    goals: g.map((x) => ({ id: x.id, ...(x.content as GoalContent) })),
    criteria: content.reviewCriteria,
    signals: await signalsForCase(ctx, plan.caseKey, 120),
    now: ctx.now(),
  });
  const now = ctx.now();
  await ctx.db.transaction(async (tx) => {
    await tx.update(reviewCycles).set({ status: 'open', computed, narrativeStatus: 'pending' }).where(eq(reviewCycles.id, cycleId));
    await tx
      .update(plans)
      .set({ status: 'under_review', updatedAt: now, transitions: [...(plan.transitions as PlanTransitionRecord[]), { from: 'active', to: 'under_review', actorUserId: 'system', at: now, rationale: `Review cycle ${cycleId} due` }] })
      .where(eq(plans.id, plan.id));
  });
  await ctx.queue.enqueue('narrate_review', { cycleId });
  // The review-cycle engine and the pattern engine are the same machinery (non-response-trajectory).
  await ctx.queue.enqueue('sweep_case', { caseKey: plan.caseKey }, { dedupeKey: plan.caseKey });
}

export async function narrateCycle(ctx: AppContext, cycleId: string) {
  const [cycle] = await ctx.db.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId)).limit(1);
  if (!cycle || !cycle.computed) return;
  const [plan] = await ctx.db.select().from(plans).where(eq(plans.id, cycle.planId)).limit(1);
  if (!plan) return;
  const g = await ctx.db.select().from(goals).where(eq(goals.planId, plan.id)).orderBy(goals.sortOrder);
  const [c] = await ctx.db.select({ gradeLevel: plans.caseKey }).from(plans).where(eq(plans.id, plan.id)).limit(1);
  void c;
  const prompts = await activePrompts(ctx.db);
  const result = await narrateReview(
    { gate: ctx.gate, prompts, caseKey: plan.caseKey, denyNames: await denyNamesForCase(ctx.db, plan.caseKey) },
    {
      computed: cycle.computed as ComputedRecommendation,
      goals: g.map((x) => ({ targetBehavior: (x.content as GoalContent).targetBehavior, observableDefinition: (x.content as GoalContent).observableDefinition })),
      gradeLevel: (plan.content as PlanContent).measurableGoals.length ? 'as recorded' : 'unknown',
    },
  );
  const runs = 'runs' in result ? result.runs : [];
  if (result.status === 'succeeded' || result.status === 'rejected') {
    await recordRuns(ctx.db, 'review_narration', plan.caseKey, runs, result.status === 'succeeded' ? 'succeeded' : 'rejected');
    await ctx.db.update(reviewCycles).set({ narrative: result.output, narrativeStatus: result.status === 'succeeded' ? 'ready' : 'needs_attention', narrativeRunId: runs.at(-1)?.runId ?? null }).where(eq(reviewCycles.id, cycleId));
  } else {
    await recordRuns(ctx.db, 'review_narration', plan.caseKey, runs, result.status === 'blocked_pii' ? 'blocked_pii' : 'failed', result.status === 'failed' ? result.error : null);
    await ctx.db.update(reviewCycles).set({ narrativeStatus: 'failed' }).where(eq(reviewCycles.id, cycleId));
  }
}

export async function requestReviewNow(ctx: AppContext, actor: Actor, planId: string) {
  const [plan] = await ctx.db.select().from(plans).where(eq(plans.id, planId)).limit(1);
  if (!plan) throw notFound('Plan not found');
  requireTeacherLike(actor, plan.caseKey);
  if (plan.status !== 'active') throw conflict(`Plan is ${plan.status}`);
  const [scheduled] = await ctx.db.select().from(reviewCycles).where(and(eq(reviewCycles.planId, planId), eq(reviewCycles.status, 'scheduled'))).limit(1);
  const id = scheduled?.id ?? newId();
  if (!scheduled) await ctx.db.insert(reviewCycles).values({ id, planId, caseKey: plan.caseKey, dueAt: ctx.now(), status: 'scheduled' });
  await openReview(ctx, id);
  return id;
}

/** The named human decides. `decision` may differ from the computed recommendation; the rationale is required when it does. */
export async function decideReview(ctx: AppContext, actor: Actor, cycleId: string, input: { decision: string; rationale: string | null }) {
  const [cycle] = await ctx.db.select().from(reviewCycles).where(eq(reviewCycles.id, cycleId)).limit(1);
  if (!cycle) throw notFound('Review cycle not found');
  const role = requireTeacherLike(actor, cycle.caseKey);
  if (!canApprovePlan(role, ctx.config.planApproverRoles)) throw forbidden(`Role ${role} may not decide reviews`);
  if (cycle.status !== 'open') throw conflict(`Review cycle is ${cycle.status}`);
  const decision = ReviewDecision.parse(input.decision);
  const computed = cycle.computed as ComputedRecommendation | null;
  if (computed && computed.decision !== decision && !input.rationale) throw conflict(`Your decision differs from the computed recommendation (${computed.decision}); a rationale is required`);
  const [plan] = await ctx.db.select().from(plans).where(eq(plans.id, cycle.planId)).limit(1);
  if (!plan) throw notFound('Plan not found');
  const now = ctx.now();
  const to: PlanStatus = decision === 'fade' ? 'faded' : decision === 'modify' || decision === 'seek_support' ? 'modified' : 'continued';
  const transitions = [...(plan.transitions as PlanTransitionRecord[]), { from: 'under_review' as const, to, actorUserId: actor.userId, at: now, rationale: input.rationale }];
  const nextDays = Math.min(...(plan.content as PlanContent).measurableGoals.map((g) => g.reviewPeriodDays), 30);
  await ctx.db.transaction(async (tx) => {
    await tx.update(reviewCycles).set({ status: 'decided', decision, rationale: input.rationale, reviewerUserId: actor.userId, decidedAt: now }).where(eq(reviewCycles.id, cycleId));
    if (to === 'faded') {
      await tx.update(plans).set({ status: 'faded', updatedAt: now, transitions }).where(eq(plans.id, plan.id));
      await tx.update(goals).set({ status: 'faded' }).where(and(eq(goals.planId, plan.id), eq(goals.status, 'active')));
    } else {
      // continued / modified return to active service and schedule the next cycle
      await tx.update(plans).set({ status: 'active', updatedAt: now, transitions: [...transitions, { from: to, to: 'active', actorUserId: actor.userId, at: now, rationale: null }] }).where(eq(plans.id, plan.id));
      await tx.insert(reviewCycles).values({ id: newId(), planId: plan.id, caseKey: plan.caseKey, dueAt: new Date(now.getTime() + nextDays * 86_400_000), status: 'scheduled' });
    }
  });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: roleForCase(actor, cycle.caseKey), action: 'review.decide', targetType: 'review_cycle', targetId: cycleId, caseKey: cycle.caseKey, metadata: { decision, computed: computed?.decision ?? null, rationale: input.rationale } });
  return { planStatus: to === 'faded' ? 'faded' : 'active' };
}
