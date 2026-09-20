import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context';
import { acknowledgeSafetyFlag, dataQuality, listCasesForActor, raiseSafetyFlag, submitIntake } from '../services/cases';
import { candidatesForCase } from '../services/patterns';
import { listDrafts } from '../services/plans';
import { rosterFor } from '../services/roster';
import { openCorrectionsForActor, requestCorrection, resolveCorrection } from '../services/transparency';
import { buildCaseView } from '../services/views';

const CaseParams = z.object({ caseKey: z.string() });

export function registerCaseRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/roster', async (req) => rosterFor(ctx.db, req.actor!));
  app.get('/api/cases', async (req) => listCasesForActor(ctx, req.actor!));

  app.post('/api/intakes', async (req, reply) => {
    const body = z.object({ studentId: z.string().optional(), caseKey: z.string().optional(), fields: z.unknown() }).parse(req.body);
    const result = await submitIntake(ctx, req.actor!, body);
    reply.code(202);
    return result;
  });

  app.get('/api/cases/:caseKey', async (req) => buildCaseView(ctx, req.actor!, CaseParams.parse(req.params).caseKey));
  app.get('/api/cases/:caseKey/data-quality', async (req) => dataQuality(ctx, req.actor!, CaseParams.parse(req.params).caseKey));
  app.get('/api/cases/:caseKey/drafts', async (req) => listDrafts(ctx, req.actor!, CaseParams.parse(req.params).caseKey));
  app.get('/api/cases/:caseKey/candidates', async (req) => {
    const { caseKey } = CaseParams.parse(req.params);
    const all = z.object({ all: z.string().optional() }).parse(req.query).all === '1';
    return candidatesForCase(ctx, req.actor!, caseKey, all);
  });

  app.post('/api/cases/:caseKey/safety-flags', async (req) => {
    const { caseKey } = CaseParams.parse(req.params);
    const { description } = z.object({ description: z.string().min(3).max(1000) }).parse(req.body);
    return { id: await raiseSafetyFlag(ctx, req.actor!, caseKey, description) };
  });
  app.post('/api/cases/:caseKey/safety-flags/:id/acknowledge', async (req) => {
    const { caseKey, id } = z.object({ caseKey: z.string(), id: z.string() }).parse(req.params);
    await acknowledgeSafetyFlag(ctx, req.actor!, caseKey, id);
    return { ok: true };
  });

  app.post('/api/cases/:caseKey/corrections', async (req) => {
    const { caseKey } = CaseParams.parse(req.params);
    const body = z.object({ subject: z.string().min(1).max(200), detail: z.string().min(1).max(3000) }).parse(req.body);
    return { id: await requestCorrection(ctx, req.actor!, caseKey, body) };
  });
  app.get('/api/corrections', async (req) => openCorrectionsForActor(ctx, req.actor!));
  app.post('/api/corrections/:id/resolve', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const { resolutionNote } = z.object({ resolutionNote: z.string().min(1).max(3000) }).parse(req.body);
    await resolveCorrection(ctx, req.actor!, id, resolutionNote);
    return { ok: true };
  });
}
