import type { FastifyInstance } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { CONTEXT_DIMENSIONS } from '@class-pulse/domain';
import type { AppContext } from '../context';
import { classSections, signals } from '../db/schema';
import { getCase, roleForCase } from '../services/cases';
import { orgContextTags } from '../services/roster';
import { logSignal, recentSignals } from '../services/signals';

const CaseParams = z.object({ caseKey: z.string() });

export function registerSignalRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Quick entry (teacher) and self-check (student). */
  app.post('/api/cases/:caseKey/signals', async (req, reply) => {
    const { caseKey } = CaseParams.parse(req.params);
    const id = await logSignal(ctx, req.actor!, caseKey, req.body);
    reply.code(201);
    return { id };
  });

  app.get('/api/cases/:caseKey/signals', async (req) => {
    const { caseKey } = CaseParams.parse(req.params);
    const role = roleForCase(req.actor!, caseKey);
    const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(500).default(100) }).parse(req.query);
    const rows = await recentSignals(ctx, caseKey, limit);
    if (role === 'student') return rows.filter((r) => r.type === 'self_check' || r.type === 'strategy_use').map(({ note: _n, ...r }) => r);
    if (role === 'guardian') return [];
    return rows;
  });

  /**
   * Context chips for quick entry (docs/01): the controlled vocabulary plus org extensions,
   * defaulted from the section's period and the teacher's last entry. One tap, no typing.
   */
  app.get('/api/cases/:caseKey/context-tags', async (req) => {
    const { caseKey } = CaseParams.parse(req.params);
    roleForCase(req.actor!, caseKey);
    const c = await getCase(ctx, caseKey);
    const [section] = await ctx.db.select().from(classSections).where(eq(classSections.id, c.sectionId)).limit(1);
    const [last] = await ctx.db
      .select({ tags: signals.contextTags })
      .from(signals)
      .where(eq(signals.caseKey, caseKey))
      .orderBy(desc(signals.createdAt))
      .limit(1);
    const extensions = await orgContextTags(ctx.db, c.schoolId);
    const dimensions: Record<string, string[]> = Object.fromEntries(Object.entries(CONTEXT_DIMENSIONS).map(([k, v]) => [k, [...v]]));
    for (const e of extensions) (dimensions[e.dimension] ??= []).push(e.tag);
    const hour = ctx.now().getHours();
    const defaults = new Set<string>(last?.tags ?? []);
    if (section?.periodTag) {
      for (const t of [...defaults]) if (t.startsWith('period_')) defaults.delete(t);
      defaults.add(section.periodTag);
    }
    defaults.delete('morning');
    defaults.delete('afternoon');
    defaults.add(hour < 12 ? 'morning' : 'afternoon');
    return { dimensions, defaults: [...defaults], sectionPeriod: section?.periodTag ?? null };
  });
}
