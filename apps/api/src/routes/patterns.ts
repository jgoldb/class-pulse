import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import { summarizeEvidence } from '@class-pulse/patterns';
import type { AppContext } from '../context';
import { patternCandidates } from '../db/schema';
import { requireTeacherLike } from '../services/cases';
import { adjudicate, candidatesForActor, detectionContextFor, getCandidate, openCandidate, sweepOneCase } from '../services/patterns';

const Id = z.object({ id: z.string() });

export function registerPatternRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/patterns/queue', async (req) => {
    const { queue } = z.object({ queue: z.enum(['teacher', 'support']).default('teacher') }).parse(req.query);
    return candidatesForActor(ctx, req.actor!, queue);
  });

  /** The pattern card: evidence first, hypothesis second, proposals third (docs/02 §3). */
  app.get('/api/candidates/:id', async (req) => {
    const cand = await getCandidate(ctx, req.actor!, Id.parse(req.params).id);
    const detection = await detectionContextFor(ctx, cand.caseKey);
    const evidence = summarizeEvidence(detection.window.signals, cand.evidenceRefs);
    const refs = new Set(cand.evidenceRefs);
    const evidenceSignals = detection.window.signals.filter((s) => refs.has(s.id)).map(({ note: _n, ...s }) => s);
    return { ...cand, evidence, evidenceSignals, order: ['evidence', 'hypothesis', 'proposals'] };
  });

  app.post('/api/candidates/:id/open', async (req) => openCandidate(ctx, req.actor!, Id.parse(req.params).id));

  /** Re-run the interpretation for a candidate whose proposal failed or needs attention (docs/03: nothing fails silently). */
  app.post('/api/candidates/:id/reinterpret', async (req, reply) => {
    const cand = await getCandidate(ctx, req.actor!, Id.parse(req.params).id);
    requireTeacherLike(req.actor!, cand.caseKey);
    if (cand.routing === 'safety_escalation') return reply.code(409).send({ error: 'Safety-escalation candidates receive no interpretation' });
    await ctx.db.update(patternCandidates).set({ proposalStatus: 'pending' }).where(eq(patternCandidates.id, cand.id));
    await ctx.queue.enqueue('interpret_candidate', { candidateId: cand.id, caseKey: cand.caseKey });
    reply.code(202);
    return { ok: true };
  });

  app.post('/api/candidates/:id/adjudicate', async (req) => {
    const { id } = Id.parse(req.params);
    const body = z
      .object({
        decision: z.enum(['confirmed', 'dismissed', 'needs_more_data', 'escalated']),
        note: z.string().max(2000).nullable().optional(),
        dismissalReason: z.string().nullable().optional(),
        collectionTarget: z.object({ signalType: z.string(), additionalObservations: z.number().int().positive() }).nullable().optional(),
        seed: z
          .union([z.object({ kind: z.literal('goal'), content: z.unknown() }), z.object({ kind: z.literal('strategy'), strategyKind: z.string(), content: z.unknown() })])
          .nullable()
          .optional(),
      })
      .parse(req.body);
    return adjudicate(ctx, req.actor!, id, body);
  });

  /** On-demand re-evaluation (docs/02 "Where it runs"). */
  app.post('/api/cases/:caseKey/sweep', async (req) => {
    const { caseKey } = z.object({ caseKey: z.string() }).parse(req.params);
    requireTeacherLike(req.actor!, caseKey);
    return sweepOneCase(ctx, caseKey);
  });
}
