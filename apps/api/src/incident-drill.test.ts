/**
 * Incident-response exercise (guide §P, docs/10 "Incident drill"). Each step rehearses a
 * containment or evidence action from the runbook against a real (in-memory) database:
 *   1. Contain: with the model switched off, nothing leaves, capture keeps working, and every
 *      refused attempt still writes an egress record.
 *   2. Preserve: audit and egress records cannot be altered or removed.
 *   3. Reconstruct: an administrator can pull the incident window from the audit trail, which
 *      holds identifiers and counts but no classroom content.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { newId } from '@class-pulse/domain';
import type { FastifyInstance } from 'fastify';
import { createApp, type AppHandle } from './bootstrap';
import { buildServer } from './server';
import { classSections, egressLog, organizations, roleAssignments, schools, sectionEnrollments, students, users } from './db/schema';

let handle: AppHandle, server: FastifyInstance;
const call = async (who: string, method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const r = await server.inject({ method, url, headers: { authorization: `Test ${who}` }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
  return { status: r.statusCode, body: r.json() };
};

beforeAll(async () => {
  handle = await createApp({ env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', AI_PROVIDER: 'off', OPENAI_API_KEY: '' }, memory: true, pollMs: 60000 });
  server = await buildServer(handle.ctx, { logger: false });
  const db = handle.ctx.db;
  await db.insert(organizations).values({ id: 'org', name: 'Synthetic workspace' });
  await db.insert(schools).values({ id: 'school', orgId: 'org', name: 'School' });
  await db.insert(classSections).values({ id: 'section', schoolId: 'school', name: 'Class', gradeLevel: '6' });
  await db.insert(users).values([{ id: 'teacher', displayName: 'Teacher', email: 't@test.school' }, { id: 'admin', displayName: 'Admin', email: 'a@test.school' }]);
  await db.insert(students).values({ id: 'a', schoolId: 'school', firstName: 'Robin', lastName: 'Sample', gradeLevel: '6' });
  await db.insert(sectionEnrollments).values({ sectionId: 'section', studentId: 'a' });
  await db.insert(roleAssignments).values([{ id: newId(), userId: 'teacher', role: 'teacher', sectionId: 'section' }, { id: newId(), userId: 'admin', role: 'administrator', schoolId: 'school' }]);
});
afterAll(async () => { await server.close(); await handle.close(); });

describe('incident drill', () => {
  const started = new Date(Date.now() - 1000);
  it('contains: model off means no egress, but capture continues and attempts are recorded', async () => {
    expect((await call('teacher', 'GET', '/health')).body.provider ?? 'disabled').toBe('disabled');
    const session = (await call('teacher', 'POST', '/api/pulse/sessions', { requestId: newId(), sectionId: 'section', date: '2026-10-01', topic: 'Drill', objective: '', contextTags: [] })).body.id;
    const event = await call('teacher', 'POST', '/api/pulse/events', { requestId: newId(), sessionId: session, studentId: 'a', source: 'teacher_tap', observedAt: new Date().toISOString(), observation: { kind: 'praise', strength: 'Helped a classmate', note: '' }, confirmed: true });
    expect(event.status).toBe(200);
    const draft = await call('teacher', 'POST', '/api/pulse/drafts', { sessionId: session, kind: 'positive_note', sources: [{ eventId: event.body.id, revision: 1 }] });
    expect((await call('teacher', 'GET', `/api/pulse/drafts/${draft.body.id}`)).body.draft.generationState).toBe('disabled');
    const transcribed = await handle.ctx.gate.transcribe({ audio: new Uint8Array([1, 2, 3]), mimeType: 'audio/webm', model: 'x', language: 'en', denyNames: [] });
    expect(transcribed.ok).toBe(false);
    const [refused] = await handle.ctx.db.select().from(egressLog).where(eq(egressLog.surface, 'voice_transcription'));
    expect(refused!.status).toBe('provider_error');
  });
  it('preserves: audit and egress records cannot be changed or removed', async () => {
    for (const statement of [sql`update working.audit_events set action = 'tampered'`, sql`delete from working.audit_events`, sql`update working.egress_log set input = 'tampered'`, sql`delete from working.egress_log`]) {
      let error: Error | null = null;
      try { await handle.ctx.db.execute(statement); } catch (e) { error = e as Error; }
      expect(`${error?.message} ${(error as { cause?: Error } | null)?.cause?.message ?? ''}`).toMatch(/append-only/i);
    }
  });
  it('reconstructs: the incident window is recoverable from the audit trail without content', async () => {
    const trail = await call('admin', 'GET', `/api/admin/audit?since=${encodeURIComponent(started.toISOString())}&limit=200`);
    expect(trail.status).toBe(200);
    const rows = (Array.isArray(trail.body) ? trail.body : trail.body.rows ?? trail.body.events ?? []) as Array<{ action: string }>;
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['classroom.capture', 'artifact.request']));
    expect(JSON.stringify(trail.body)).not.toContain('Helped a classmate');
  });
});
