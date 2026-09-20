import type { FastifyInstance } from 'fastify';
import { eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import type { AppContext } from '../context';
import { notFound } from '../context';
import { reviewCycles } from '../db/schema';
import { requireTeacherLike } from '../services/cases';
import { decideReview } from '../services/reviews';

const Id = z.object({ id: z.string() });

export function registerReviewRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Review reminders: cycles open or due soon on the caller's cases. */
  app.get('/api/reviews', async (req) => {
    const keys = [...req.actor!.scope.caseRoles.entries()].filter(([, r]) => r === 'teacher' || r === 'support_professional').map(([k]) => k);
    if (!keys.length) return [];
    const rows = await ctx.db.select().from(reviewCycles).where(inArray(reviewCycles.caseKey, keys)).orderBy(reviewCycles.dueAt);
    const soon = ctx.now().getTime() + 7 * 86_400_000;
    return rows.filter((r) => r.status === 'open' || (r.status === 'scheduled' && r.dueAt.getTime() <= soon)).map((r) => ({ id: r.id, caseKey: r.caseKey, planId: r.planId, dueAt: r.dueAt, status: r.status, narrativeStatus: r.narrativeStatus, computedDecision: (r.computed as { decision?: string } | null)?.decision ?? null }));
  });

  app.get('/api/reviews/:id', async (req) => {
    const [row] = await ctx.db.select().from(reviewCycles).where(eq(reviewCycles.id, Id.parse(req.params).id)).limit(1);
    if (!row) throw notFound('Review cycle not found');
    requireTeacherLike(req.actor!, row.caseKey);
    return row;
  });

  app.post('/api/reviews/:id/decide', async (req) => {
    const { id } = Id.parse(req.params);
    const body = z.object({ decision: z.string(), rationale: z.string().max(2000).nullable().optional() }).parse(req.body);
    return decideReview(ctx, req.actor!, id, { decision: body.decision, rationale: body.rationale ?? null });
  });
}
