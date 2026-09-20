import type { FastifyInstance } from 'fastify';
import { inArray } from 'drizzle-orm';
import { z } from 'zod';
import { detectPii, redactPii } from '@class-pulse/ai/pii';
import type { AppContext } from '../context';
import { students, users } from '../db/schema';

/**
 * "Catch PII at the keyboard, not at the gate" (docs/04). The intake form and quick-entry note
 * call this as the teacher types; the response carries spans and a one-tap redaction.
 * The denylist is the roster of the caller's own students plus staff names — never returned.
 */
export function registerPiiRoutes(app: FastifyInstance, ctx: AppContext) {
  app.post('/api/pii/scan', async (req) => {
    const { text } = z.object({ text: z.string().max(10_000) }).parse(req.body);
    const ids = [...req.actor!.scope.identifiedStudentIds];
    const names = new Set<string>();
    if (ids.length) {
      const rows = await ctx.db.select({ f: students.firstName, l: students.lastName }).from(students).where(inArray(students.id, ids));
      for (const r of rows) {
        names.add(`${r.f} ${r.l}`);
        names.add(r.f);
        names.add(r.l);
      }
    }
    for (const u of await ctx.db.select({ n: users.displayName }).from(users)) names.add(u.n);
    const spans = detectPii(text, { denyNames: [...names].filter((n) => n.length >= 3) });
    return { spans, redacted: spans.length ? redactPii(text, spans) : text, blocking: spans.some((s) => s.confidence === 'high') };
  });
}
