import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { PLAN_STATUSES, STRATEGY_KINDS, newId } from '@class-pulse/domain';
import type { AppContext } from '../context';
import { conflict, notFound } from '../context';
import { goals, planDrafts, plans } from '../db/schema';
import { requireTeacherLike } from '../services/cases';
import { addGoal, addStrategy, approveDraft, discardDraft, getDraft, planWithChildren, transitionPlan, updateGoal, updateStrategy } from '../services/plans';
import { requestReviewNow } from '../services/reviews';
import { progressForGoal } from '../services/signals';

const Id = z.object({ id: z.string() });

export function registerPlanRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/drafts/:id', async (req) => getDraft(ctx, req.actor!, Id.parse(req.params).id));

  app.post('/api/drafts/:id/approve', async (req) => {
    const { id } = Id.parse(req.params);
    const body = z.object({ content: z.unknown(), rationale: z.string().max(2000).nullable().optional() }).parse(req.body);
    return approveDraft(ctx, req.actor!, id, body.content, body.rationale ?? null);
  });

  app.post('/api/drafts/:id/discard', async (req) => {
    await discardDraft(ctx, req.actor!, Id.parse(req.params).id);
    return { ok: true };
  });

  /** Re-run generation from the same intake (after a failure, a PII block, or a needs_attention result). */
  app.post('/api/drafts/:id/regenerate', async (req, reply) => {
    const draft = await getDraft(ctx, req.actor!, Id.parse(req.params).id);
    if (draft.status === 'approved') throw conflict('Draft already approved');
    const newDraftId = newId();
    await ctx.db.insert(planDrafts).values({ id: newDraftId, caseKey: draft.caseKey, intakeId: draft.intakeId, status: 'queued', createdBy: req.actor!.userId });
    await ctx.queue.enqueue('generate_plan', { draftId: newDraftId, caseKey: draft.caseKey });
    reply.code(202);
    return { draftId: newDraftId };
  });

  app.get('/api/plans/:id', async (req) => {
    const { id } = Id.parse(req.params);
    const [p] = await ctx.db.select({ caseKey: plans.caseKey }).from(plans).where(eq(plans.id, id)).limit(1);
    if (!p) throw notFound('Plan not found');
    requireTeacherLike(req.actor!, p.caseKey);
    return planWithChildren(ctx, id);
  });

  app.post('/api/plans/:id/transition', async (req) => {
    const { id } = Id.parse(req.params);
    const body = z.object({ to: z.enum(PLAN_STATUSES), rationale: z.string().max(2000).nullable().optional() }).parse(req.body);
    await transitionPlan(ctx, req.actor!, id, body.to, body.rationale ?? null);
    return { ok: true };
  });

  app.post('/api/plans/:id/goals', async (req) => {
    const { id } = Id.parse(req.params);
    const { content } = z.object({ content: z.unknown() }).parse(req.body);
    return { id: await addGoal(ctx, req.actor!, id, content) };
  });
  app.patch('/api/goals/:id', async (req) => {
    const { id } = Id.parse(req.params);
    const body = z.object({ content: z.unknown().optional(), status: z.string().optional() }).parse(req.body);
    await updateGoal(ctx, req.actor!, id, body);
    return { ok: true };
  });
  app.get('/api/goals/:id/progress', async (req) => {
    const { id } = Id.parse(req.params);
    const [g] = await ctx.db.select({ caseKey: goals.caseKey }).from(goals).where(eq(goals.id, id)).limit(1);
    if (!g) throw notFound('Goal not found');
    // Any role on the case may read progress (students and guardians see it through the case view too).
    if (!req.actor!.scope.caseRoles.has(g.caseKey)) throw notFound('Goal not found');
    return progressForGoal(ctx, id);
  });

  app.post('/api/plans/:id/strategies', async (req) => {
    const { id } = Id.parse(req.params);
    const body = z.object({ kind: z.enum(STRATEGY_KINDS), content: z.unknown() }).parse(req.body);
    return { id: await addStrategy(ctx, req.actor!, id, body.kind, body.content) };
  });
  app.patch('/api/strategies/:id', async (req) => {
    const { id } = Id.parse(req.params);
    const body = z.object({ content: z.unknown().optional(), status: z.enum(['active', 'retired']).optional() }).parse(req.body);
    await updateStrategy(ctx, req.actor!, id, body);
    return { ok: true };
  });

  app.post('/api/plans/:id/review-now', async (req) => ({ cycleId: await requestReviewNow(ctx, req.actor!, Id.parse(req.params).id) }));
}
