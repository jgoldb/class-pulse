import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { newId } from '@class-pulse/domain';
import { EVAL_CASES } from '@class-pulse/ai/evals';
import { createApp, type AppHandle } from './bootstrap';
import { buildServer } from './server';
import { buildGate } from './services/ai';
import { enqueueTomorrowSchedules } from './services/tomorrow';
import { expirePendingClassroomContent } from './services/pulse-retention';
import { seedPrompts } from './services/prompts';
import { expireContributions } from './services/contributions';
import type { FastifyInstance } from 'fastify';
import { artifactPublications, auditEvents, promptVersions, cases, caseLinks, classSections, classSessions, classroomDrafts, classroomEgressPayloads, classroomEvents, egressLog, eventRevisions, followUpTasks, jobs, learnerLinks, organizations, roleAssignments, schools, sectionEnrollments, signalProjections, signals, students, tomorrowSchedules, users } from './db/schema';

let handle: AppHandle, server: FastifyInstance;
const ids = { teacher: 'teacher', other: 'other', coteacher: 'coteacher', guardian: 'guardian', student: 'student', admin: 'admin' };
const call = async (who: keyof typeof ids, method: 'GET' | 'POST', url: string, payload?: unknown) => {
  const r = await server.inject({ method, url, headers: { authorization: `Test ${ids[who]}` }, ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }) });
  return { status: r.statusCode, body: r.json() };
};
beforeAll(async () => {
  handle = await createApp({ env: { ...process.env, NODE_ENV: 'test', DATABASE_URL: '', AI_PROVIDER: 'off', OPENAI_API_KEY: '' }, memory: true, pollMs: 60000 });
  server = await buildServer(handle.ctx, { logger: false });
  const db = handle.ctx.db;
  await db.insert(organizations).values({ id: 'org', name: 'Synthetic workspace' });
  await db.insert(schools).values([{ id: 'school', orgId: 'org', name: 'School' }, { id: 'outside', orgId: 'org', name: 'Other school' }]);
  await db.insert(classSections).values([{ id: 'section', schoolId: 'school', name: 'Class', gradeLevel: '6' }, { id: 'other-section', schoolId: 'outside', name: 'Other', gradeLevel: '6' }]);
  await db.insert(users).values(Object.values(ids).map((id) => ({ id, displayName: id, email: `${id}@test.school` })));
  await db.insert(students).values([{ id: 'a', schoolId: 'school', firstName: 'Robin', lastName: 'Sample', gradeLevel: '6' }, { id: 'b', schoolId: 'school', firstName: 'Casey', lastName: 'Example', gradeLevel: '6' }, { id: 'x', schoolId: 'outside', firstName: 'Alex', lastName: 'Elsewhere', gradeLevel: '6' }]);
  await db.insert(sectionEnrollments).values([{ sectionId: 'section', studentId: 'a' }, { sectionId: 'section', studentId: 'b' }, { sectionId: 'other-section', studentId: 'x' }]);
  await db.insert(roleAssignments).values([
    { id: newId(), userId: 'teacher', role: 'teacher', sectionId: 'section' },
    { id: newId(), userId: 'coteacher', role: 'teacher', sectionId: 'section' },
    { id: newId(), userId: 'other', role: 'teacher', sectionId: 'other-section' },
    { id: newId(), userId: 'guardian', role: 'guardian', studentId: 'a' },
    { id: newId(), userId: 'student', role: 'student', studentId: 'a' },
    { id: newId(), userId: 'admin', role: 'administrator', schoolId: 'school' },
    { id: newId(), userId: 'admin', role: 'administrator', schoolId: 'outside' },
  ]);
});

afterAll(async () => { await server.close(); await handle.close(); });
let sessionId: string, eventId: string;
const participation = { kind: 'participation', action: 'contributed', note: '' };
const capture = (extra: Record<string, unknown> = {}) => ({ requestId: newId(), sessionId, studentId: 'a', source: 'teacher_tap', observedAt: new Date().toISOString(), observation: participation, confirmed: true, ...extra });
describe('Pulsera classroom foundation', () => {
  it('is on by default for a synthetic workspace; settings require an administrator and a valid school timezone', async () => {
    expect((await call('teacher', 'GET', '/api/pulse/sections')).body[0].enabled).toBe(true);
    const settings = { schoolId: 'school', enabled: true, timezone: 'America/New_York' };
    expect((await call('teacher', 'POST', '/api/pulse/settings', settings)).status).toBe(403);
    expect((await call('admin', 'POST', '/api/pulse/settings', { ...settings, timezone: 'Mars' })).status).toBe(400);
    expect((await call('admin', 'POST', '/api/pulse/settings', settings)).status).toBe(200);
  });
  it('turns existing workspaces on by migration only where every learner is synthetic', async () => {
    const db = handle.ctx.db;
    await db.insert(organizations).values([{ id: 'org-synthetic', name: 'Synthetic', pulseraEnabled: false }, { id: 'org-real', name: 'Real', pulseraEnabled: false }]);
    await db.insert(schools).values([{ id: 'school-synthetic', orgId: 'org-synthetic', name: 'S' }, { id: 'school-real', orgId: 'org-real', name: 'R' }]);
    await db.insert(students).values([{ id: 'syn', schoolId: 'school-synthetic', firstName: 'Lane', lastName: 'Fixture', gradeLevel: '6' }, { id: 'real', schoolId: 'school-real', firstName: 'Taylor', lastName: 'Person', gradeLevel: '6', synthetic: false }]);
    const backfill = readFileSync(new URL('../drizzle/0016_pulsera_on_by_default.sql', import.meta.url), 'utf8').split('--> statement-breakpoint')[1]!;
    await db.execute(sql.raw(backfill));
    const flags = await db.select({ id: organizations.id, enabled: organizations.pulseraEnabled }).from(organizations).where(inArray(organizations.id, ['org-synthetic', 'org-real']));
    expect(Object.fromEntries(flags.map((f) => [f.id, f.enabled]))).toEqual({ 'org-synthetic': true, 'org-real': false });
  });
  it('snapshots seating, deduplicates sessions, and rejects reused request IDs', async () => {
    const seats = { expectedVersion: 0, positions: [{ studentId: 'a', row: 0, column: 0 }, { studentId: 'b', row: 0, column: 1 }] };
    expect((await call('teacher', 'POST', '/api/pulse/seating/section', seats)).status).toBe(200);
    expect((await call('teacher', 'POST', '/api/pulse/seating/section', seats)).status).toBe(409);
    const input = { requestId: newId(), sectionId: 'section', date: '2026-09-30', topic: 'Fractions', objective: 'Place fractions on a number line', contextTags: ['period_1'] };
    const first = await call('teacher', 'POST', '/api/pulse/sessions', input);
    expect(first.status).toBe(200); sessionId = first.body.id;
    expect((await call('teacher', 'POST', '/api/pulse/sessions', input)).body.id).toBe(sessionId);
    expect((await call('teacher', 'POST', '/api/pulse/sessions', { ...input, topic: 'Changed' })).status).toBe(409);
    expect((await call('teacher', 'POST', '/api/pulse/seating/section', { expectedVersion: 1, positions: [{ studentId: 'a', row: 1, column: 0 }] })).status).toBe(200);
    const result = await call('teacher', 'GET', `/api/pulse/sessions/${sessionId}`);
    expect(result.body.seating).toHaveLength(2);
    expect(result.body.session.timezone).toBe('America/New_York');
  });
  it('captures without a case or AI, retaining exact authorship and deduplicating concurrent saves', async () => {
    const input = capture();
    const [a, b] = await Promise.all([call('teacher', 'POST', '/api/pulse/events', input), call('teacher', 'POST', '/api/pulse/events', input)]);
    expect(a.status).toBe(200); expect(b.status).toBe(200); expect(a.body.id).toBe(b.body.id); eventId = a.body.id;
    expect(await handle.ctx.db.select().from(cases)).toHaveLength(0);
    expect(await handle.ctx.db.select().from(eventRevisions).where(eq(eventRevisions.eventId, eventId))).toHaveLength(1);
    const result = await call('teacher', 'GET', `/api/pulse/sessions/${sessionId}`);
    expect(result.body.events[0]).toMatchObject({ confirmedBy: 'teacher', status: 'confirmed', source: 'teacher_tap', studentId: 'a' });
    expect((await call('teacher', 'POST', '/api/pulse/events', { ...input, studentId: 'b' })).status).toBe(409);
  });
  it('records a free-form note as its own observation and rejects an empty one', async () => {
    const saved = await call('teacher', 'POST', '/api/pulse/events', capture({ observation: { kind: 'note', note: 'Worked through the warm-up with a partner' } }));
    expect(saved.status).toBe(200);
    expect((await call('teacher', 'POST', '/api/pulse/events', capture({ observation: { kind: 'note', note: '  ' } }))).status).toBe(400);
    expect((await call('teacher', 'POST', '/api/pulse/events', capture({ observation: { kind: 'note', note: 'Robin Sample worked well' } }))).status).toBe(400);
    expect((await call('teacher', 'POST', `/api/pulse/events/${saved.body.id}/withdraw`, { expectedRevision: 1 })).status).toBe(200);
  });
  it('keeps each teacher’s quick-pick wording private, name-free and resettable', async () => {
    const initial = await call('teacher', 'GET', '/api/pulse/vocabulary');
    expect(initial.body).toMatchObject({ custom: false, vocabulary: initial.body.defaults });
    const mine = { praise: ['Used the number line', 'Encouraged a partner'], checkIn: ['Checked step two'] };
    expect((await call('teacher', 'POST', '/api/pulse/vocabulary', { vocabulary: mine })).body).toMatchObject({ custom: true, vocabulary: mine });
    expect((await call('coteacher', 'GET', '/api/pulse/vocabulary')).body.custom).toBe(false);
    expect((await call('teacher', 'POST', '/api/pulse/vocabulary', { vocabulary: { praise: ['Robin Sample helped'], checkIn: ['Offered help'] } })).status).toBe(400);
    expect((await call('teacher', 'POST', '/api/pulse/vocabulary', { vocabulary: { praise: ['Same', 'same'], checkIn: ['Offered help'] } })).status).toBe(400);
    expect((await call('guardian', 'POST', '/api/pulse/vocabulary', { vocabulary: mine })).status).toBe(403);
    expect((await call('teacher', 'POST', '/api/pulse/vocabulary', { vocabulary: null })).body.custom).toBe(false);
  });
  it('rejects other roles, private co-teacher access, cross-section subjects, PII, and untyped fields', async () => {
    for (const who of ['other', 'guardian', 'student', 'admin', 'coteacher'] as const) {
      expect((await call(who, 'GET', `/api/pulse/sessions/${sessionId}`)).status).toBe(403);
      expect((await call(who, 'POST', '/api/pulse/events', capture())).status).toBe(403);
    }
    expect((await call('teacher', 'POST', '/api/pulse/events', capture({ studentId: 'x' }))).status).toBe(403);
    expect((await call('teacher', 'POST', '/api/pulse/events', capture({ observation: { ...participation, note: 'Robin asked a question' } }))).status).toBe(400);
    expect((await call('teacher', 'POST', '/api/pulse/events', capture({ observation: { ...participation, goalId: 'unvalidated' } }))).status).toBe(400);
  });
  it('keeps missing ABC and unmeasured count null and leaves pending wording unapproved', async () => {
    const observation = { kind: 'behavior', action: 'Left seat during independent work', antecedent: null, consequence: null, measuredCount: null, note: '' };
    const event = await call('teacher', 'POST', '/api/pulse/events', capture({ confirmed: false, observation, source: 'reviewed_transcript' }));
    expect(event.status).toBe(200);
    const result = await call('teacher', 'GET', `/api/pulse/sessions/${sessionId}`);
    expect(result.body.events.find((e: { id: string }) => e.id === event.body.id)).toMatchObject({ status: 'pending', confirmedAt: null, observation });
    expect((await call('teacher', 'POST', `/api/pulse/events/${event.body.id}/confirm`, { expectedRevision: 2 })).status).toBe(409);
    expect((await call('teacher', 'POST', `/api/pulse/events/${event.body.id}/confirm`, { expectedRevision: 1 })).status).toBe(200);
    expect((await call('teacher', 'POST', `/api/pulse/events/${event.body.id}/confirm`, { expectedRevision: 1 })).status).toBe(200);
  });
  it('corrects attribution with lineage, rejects stale edits and approvals, and supports retry-safe undo', async () => {
    const input = { requestId: newId(), expectedRevision: 1, studentId: 'b', observation: participation, reason: 'Selected the wrong student', confirmed: true };
    expect((await call('teacher', 'POST', `/api/pulse/events/${eventId}/revise`, input)).body.revision).toBe(2);
    expect((await call('teacher', 'POST', `/api/pulse/events/${eventId}/revise`, input)).body.revision).toBe(2);
    expect((await call('teacher', 'POST', `/api/pulse/events/${eventId}/revise`, { ...input, requestId: newId() })).status).toBe(409);
    expect((await call('teacher', 'POST', `/api/pulse/events/${eventId}/confirm`, { expectedRevision: 1 })).status).toBe(409);
    expect(await handle.ctx.db.select().from(eventRevisions).where(eq(eventRevisions.eventId, eventId))).toHaveLength(2);
    const result = await call('teacher', 'GET', `/api/pulse/sessions/${sessionId}`);
    expect(result.body.events.find((e: { id: string }) => e.id === eventId).studentId).toBe('b');
    expect((await call('teacher', 'POST', `/api/pulse/events/${eventId}/withdraw`, { expectedRevision: 1 })).status).toBe(409);
    for (let i = 0; i < 2; i++) expect((await call('teacher', 'POST', `/api/pulse/events/${eventId}/withdraw`, { expectedRevision: 2 })).status).toBe(200);
    expect((await call('teacher', 'POST', `/api/pulse/events/${eventId}/confirm`, { expectedRevision: 2 })).status).toBe(409);
    const audits = await handle.ctx.db.select().from(auditEvents).where(and(eq(auditEvents.targetId, eventId), eq(auditEvents.action, 'classroom.correct')));
    expect(audits).toHaveLength(1); expect(JSON.stringify(audits[0]!.metadata)).not.toContain(input.reason);
  });
  it('disabling preserves records and blocks entry; revoked assignments block reads', async () => {
    const before = await handle.ctx.db.select().from(classroomEvents);
    expect((await call('admin', 'POST', '/api/pulse/settings', { schoolId: 'school', enabled: false, timezone: 'America/New_York' })).status).toBe(200);
    expect((await call('teacher', 'POST', '/api/pulse/events', capture())).status).toBe(409);
    expect(await handle.ctx.db.select().from(classroomEvents)).toEqual(before);
    await call('admin', 'POST', '/api/pulse/settings', { schoolId: 'school', enabled: true, timezone: 'America/New_York' });
    await handle.ctx.db.delete(roleAssignments).where(eq(roleAssignments.userId, 'coteacher'));
    expect((await call('coteacher', 'GET', `/api/pulse/sessions?sectionId=section`)).status).toBe(403);
    await handle.ctx.db.insert(roleAssignments).values({ id: newId(), userId: 'coteacher', role: 'teacher', sectionId: 'section' });
  });
  it('backfills legacy identity links repeatably without adding approvals or changing case provenance', async () => {
    await handle.ctx.db.insert(cases).values({ caseKey: 'legacy', sectionId: 'section', schoolId: 'school', gradeLevel: '6' });
    await handle.ctx.db.insert(caseLinks).values({ caseKey: 'legacy', studentId: 'x', createdBy: 'teacher' });
    const [before] = await handle.ctx.db.select().from(cases).where(eq(cases.caseKey, 'legacy'));
    const content = readFileSync(new URL('../drizzle/0004_pulsera_classroom_foundation.sql', import.meta.url), 'utf8');
    const backfill = content.slice(content.indexOf('DO $$'));
    await handle.ctx.db.execute(sql.raw(backfill));
    const links = await handle.ctx.db.select().from(learnerLinks);
    await handle.ctx.db.execute(sql.raw(backfill));
    expect(await handle.ctx.db.select().from(learnerLinks)).toEqual(links);
    const [after] = await handle.ctx.db.select().from(cases).where(eq(cases.caseKey, 'legacy'));
    expect(after).toMatchObject({ ...before, learnerKey: links.find((l) => l.studentId === 'x')!.learnerKey });
    expect(await handle.ctx.db.select().from(classSessions)).toHaveLength(1);
  });
});

describe('classroom draft publication', () => {
  let sourceId: string, draftId: string;
  it('reports disabled generation independently of saved capture', async () => {
    const source = await call('teacher', 'POST', '/api/pulse/events', capture());
    sourceId = source.body.id;
    const input = { sessionId, kind: 'parent_message', sources: [{ eventId: sourceId, revision: 1 }] };
    const a = await call('teacher', 'POST', '/api/pulse/drafts', input);
    expect(a.status).toBe(200); draftId = a.body.id;
    expect((await call('teacher', 'POST', '/api/pulse/drafts', input)).body.id).toBe(draftId);
    const read = await call('teacher', 'GET', `/api/pulse/drafts/${draftId}`);
    expect(read.body.draft.generationState).toBe('disabled');
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draftId}/approve`, { expectedRevision: 1, audience: 'family' })).status).toBe(409);
    expect((await call('guardian', 'GET', '/api/pulse/drafts')).body).toEqual([]);
    expect((await call('guardian', 'GET', `/api/pulse/drafts/${draftId}`)).status).toBe(403);
  });
  it('requires classroom-specific eval promotion, then generates from minimized evidence', async () => {
    Object.assign(handle.ctx, buildGate(handle.ctx.db, { NODE_ENV: 'test', AI_PROVIDER: 'mock' }));
    expect((await call('admin', 'POST', '/api/admin/prompts/classroom_draft.v1/promote', {})).status).toBe(400);
    const evaluation = await call('admin', 'POST', '/api/admin/prompts/classroom_draft.v1/evals', {});
    expect(evaluation.body.passed).toBe(true);
    expect((await call('admin', 'POST', '/api/admin/prompts/classroom_draft.v1/promote', {})).status).toBe(200);
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draftId}/retry`, {})).status).toBe(200);
    await handle.ctx.queue.drain();
    const read = await call('teacher', 'GET', `/api/pulse/drafts/${draftId}`);
    expect(read.body.draft.generationState).toBe('ready');
    expect(read.body.draft.reviewState).toBe('suggested');
    const logs = await handle.ctx.db.select().from(egressLog).where(eq(egressLog.surface, 'classroom_draft'));
    expect(logs.length).toBeGreaterThan(0);
    for (const log of logs) {
      for (const forbidden of ['learnerKey', 'studentId', 'eventId', sourceId, 'Robin', 'Sample']) expect(log.input).not.toContain(forbidden);
    }
    const payloads = await handle.ctx.db.select().from(classroomEgressPayloads);
    expect(payloads.length).toBeGreaterThan(0);
    for (const payload of payloads) for (const forbidden of ['learnerKey', 'studentId', 'eventId', sourceId, 'Robin', 'Sample']) expect(payload.input).not.toContain(forbidden);
  });
  it('activates the evaluated seed version on boot only when nothing is active', async () => {
    const db = handle.ctx.db;
    const status = async () => Object.fromEntries((await db.select({ id: promptVersions.id, status: promptVersions.status }).from(promptVersions).where(eq(promptVersions.surface, 'classroom_draft'))).map((p) => [p.id, p.status]));
    await seedPrompts(db);
    expect(await status()).toMatchObject({ 'classroom_draft.v1': 'active', 'classroom_draft.v4': 'retired' });
    // An existing database that never promoted a classroom prompt (as on Fly before 2026-10-01).
    await db.update(promptVersions).set({ status: 'draft' }).where(eq(promptVersions.surface, 'classroom_draft'));
    await seedPrompts(db);
    expect(await status()).toEqual({ 'classroom_draft.v1': 'draft', 'classroom_draft.v2': 'draft', 'classroom_draft.v3': 'draft', 'classroom_draft.v4': 'active' });
    // A database still on the older system version (as on Fly before this deploy) upgrades on boot.
    await db.update(promptVersions).set({ status: 'draft' }).where(eq(promptVersions.id, 'classroom_draft.v4'));
    await db.update(promptVersions).set({ status: 'active' }).where(eq(promptVersions.id, 'classroom_draft.v3'));
    await seedPrompts(db);
    expect(await status()).toMatchObject({ 'classroom_draft.v3': 'retired', 'classroom_draft.v4': 'active' });
    await db.update(promptVersions).set({ status: 'retired' }).where(eq(promptVersions.id, 'classroom_draft.v4'));
    await db.update(promptVersions).set({ status: 'active' }).where(eq(promptVersions.id, 'classroom_draft.v1'));
  });
  it('requires exact version approval, atomically publishes once, and never sends a message', async () => {
    const read = await call('teacher', 'GET', `/api/pulse/drafts/${draftId}`);
    const content = { ...read.body.revisions[0].content, message: 'A classroom contribution was recorded.' };
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draftId}/edit`, { expectedRevision: 1, content })).body.revision).toBe(2);
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draftId}/approve`, { expectedRevision: 1, audience: 'family' })).status).toBe(409);
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draftId}/export`, {})).status).toBe(409);
    const [a, b] = await Promise.all([call('teacher', 'POST', `/api/pulse/drafts/${draftId}/approve`, { expectedRevision: 2, audience: 'family' }), call('teacher', 'POST', `/api/pulse/drafts/${draftId}/approve`, { expectedRevision: 2, audience: 'family' })]);
    expect(a.status).toBe(200); expect(b.body.id).toBe(a.body.id);
    expect(await handle.ctx.db.select().from(artifactPublications).where(eq(artifactPublications.draftId, draftId))).toHaveLength(1);
    const exported = await call('teacher', 'POST', `/api/pulse/drafts/${draftId}/export`, {});
    expect(exported.body.content).toEqual(content); expect(exported.body.delivery).toBe('not_sent');
  });
  it('lists each draft with who it concerns, what it came from and its approved audience', async () => {
    const row = (await call('teacher', 'GET', '/api/pulse/drafts')).body.find((d: { id: string }) => d.id === draftId);
    expect(row).toMatchObject({ students: [{ id: 'a', displayName: 'Robin Sample' }], evidenceKinds: ['participation'], session: { date: '2026-09-30', topic: 'Fractions' }, approvedAudience: 'family' });
    expect(typeof row.title).toBe('string');
  });
  it('invalidates already approved derivatives when source attribution changes', async () => {
    await call('teacher', 'POST', `/api/pulse/events/${sourceId}/revise`, { requestId: newId(), expectedRevision: 1, studentId: 'b', observation: participation, reason: 'Corrected attribution', confirmed: true });
    const [draft] = await handle.ctx.db.select().from(classroomDrafts).where(eq(classroomDrafts.id, draftId));
    expect(draft).toMatchObject({ reviewState: 'stale', publicationState: 'needs_review' });
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draftId}/export`, {})).status).toBe(409);
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draftId}/approve`, { expectedRevision: 2, audience: 'family' })).status).toBe(409);
    const stale = (await call('teacher', 'GET', '/api/pulse/drafts')).body.find((d: { id: string }) => d.id === draftId);
    expect(stale).toMatchObject({ reviewState: 'stale', sources: [], students: [], evidenceKinds: [], title: null });
  });
});


describe('scheduled preparation and pending retention', () => {
  it('atomically claims one class-date job across concurrent schedulers', async () => {
    const now = handle.ctx.now;
    handle.ctx.now = () => new Date('2026-09-30T20:00:00Z');
    try {
      const settings = { enabled: true, time: '15:30', classWeekdays: [1, 2, 3, 4, 5], closureDates: ['2026-10-01'] };
      expect((await call('teacher', 'POST', '/api/pulse/tomorrow/section', settings)).status).toBe(200);
      expect((await call('other', 'POST', '/api/pulse/tomorrow/section', settings)).status).toBe(403);
      await Promise.all([enqueueTomorrowSchedules(handle.ctx), enqueueTomorrowSchedules(handle.ctx)]);
      expect(await handle.ctx.db.select().from(jobs).where(eq(jobs.type, 'prepare_tomorrow'))).toHaveLength(1);
      await handle.ctx.queue.drain();
      const [schedule] = await handle.ctx.db.select().from(tomorrowSchedules);
      expect(schedule!.targetDate).toBe('2026-10-02');
      expect(schedule!.lastResult).toContain('requested');
      const [draft] = await handle.ctx.db.select().from(classroomDrafts).where(eq(classroomDrafts.kind, 'do_now'));
      expect(draft!.reviewState).toBe('suggested');
      expect((await call('teacher', 'POST', '/api/pulse/events', capture({ observedAt: handle.ctx.now().toISOString() }))).status).toBe(200);
      const [stale] = await handle.ctx.db.select().from(classroomDrafts).where(eq(classroomDrafts.id, draft!.id));
      expect(stale!.reviewState).toBe('stale');
    } finally { handle.ctx.now = now; }
  });
  it('erases expired unapproved text with content-free audit metadata, preserving approved publications', async () => {
    const input = capture({ confirmed: false, observation: { kind: 'check_in', observation: 'Asked for extra practice', note: 'temporary draft text' } });
    const event = await call('teacher', 'POST', '/api/pulse/events', input);
    const withdrawn = await call('teacher', 'POST', '/api/pulse/events', capture({ confirmed: false }));
    await call('teacher', 'POST', `/api/pulse/events/${withdrawn.body.id}/withdraw`, { expectedRevision: 1 });
    const now = handle.ctx.now;
    handle.ctx.now = () => new Date(Date.now() + 31 * 86400000);
    const approvedBefore = await handle.ctx.db.select().from(artifactPublications);
    try {
      const result = await expirePendingClassroomContent(handle.ctx);
      expect(result.eventsExpired).toBeGreaterThan(0);
      expect(await handle.ctx.db.select().from(eventRevisions).where(eq(eventRevisions.eventId, event.body.id))).toHaveLength(0);
      expect(await handle.ctx.db.select().from(eventRevisions).where(eq(eventRevisions.eventId, withdrawn.body.id))).toHaveLength(0);
      expect((await call('teacher', 'POST', '/api/pulse/events', input)).status).toBe(409);
      expect(await handle.ctx.db.select().from(artifactPublications)).toEqual(approvedBefore);
      const audit = await handle.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'classroom.expire'));
      expect(JSON.stringify(audit)).not.toContain('temporary draft text');
      expect(await expirePendingClassroomContent(handle.ctx)).toEqual({ eventsExpired: 0, draftsExpired: 0 });
    } finally { handle.ctx.now = now; }
  });
});


describe('no-case profiles and attributed collaboration', () => {
  const profile = (who: keyof typeof ids, studentId: string, role: string) => call(who, 'GET', `/api/pulse/people/${studentId}?role=${role}&sectionId=section`);
  it('supports multiple children without cases and rejects other relationships or sections', async () => {
    expect((await call('student', 'GET', '/api/pulse/people?role=student')).body.map((p: { id: string }) => p.id)).toEqual(['a']);
    expect((await profile('student', 'b', 'student')).status).toBe(403);
    expect((await profile('admin', 'a', 'teacher')).status).toBe(403);
    expect((await call('guardian', 'GET', '/api/pulse/people/a?role=guardian&sectionId=other-section')).status).toBe(403);
    await handle.ctx.db.insert(roleAssignments).values({ id: newId(), userId: 'guardian', role: 'guardian', studentId: 'b' });
    expect((await call('guardian', 'GET', '/api/pulse/people?role=guardian')).body.map((p: { id: string }) => p.id).sort()).toEqual(['a', 'b']);
    const noCase = await profile('guardian', 'b', 'guardian');
    expect(noCase.status).toBe(200); expect(noCase.body.caseKeys).toEqual([]);
    expect(noCase.body.history).toEqual([]); expect(noCase.body.acceptedContributions).toEqual([]);
  });
  it('does not share approval automatically, filters audiences, and removes corrected or revoked content', async () => {
    const source = await call('teacher', 'POST', '/api/pulse/events', capture({ observation: { kind: 'praise', strength: 'Explained a worked example', note: 'Private instructional context' } }));
    const draft = await call('teacher', 'POST', '/api/pulse/drafts', { sessionId, kind: 'positive_note', sources: [{ eventId: source.body.id, revision: 1 }] });
    await handle.ctx.queue.drain();
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/share`, { expectedRevision: 1, shared: true })).status).toBe(409);
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/approve`, { expectedRevision: 1, audience: 'family' })).status).toBe(200);
    expect((await profile('guardian', 'a', 'guardian')).body.successes).toEqual([]);
    expect((await call('coteacher', 'POST', `/api/pulse/drafts/${draft.body.id}/share`, { expectedRevision: 1, shared: true })).status).toBe(403);
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/share`, { expectedRevision: 1, shared: true })).status).toBe(200);
    const visible = await profile('guardian', 'a', 'guardian');
    expect(visible.body.successes).toHaveLength(1);
    expect(JSON.stringify(visible.body)).not.toContain('Private instructional context');
    expect(JSON.stringify(visible.body)).not.toContain('learnerKey');
    expect((await profile('student', 'a', 'student')).body.successes).toEqual([]);
    expect((await profile('guardian', 'b', 'guardian')).body.successes).toEqual([]);
    await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/share`, { expectedRevision: 1, shared: false });
    expect((await profile('guardian', 'a', 'guardian')).body.successes).toEqual([]);
    await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/share`, { expectedRevision: 1, shared: true });
    await call('teacher', 'POST', `/api/pulse/events/${source.body.id}/withdraw`, { expectedRevision: 1 });
    expect((await profile('guardian', 'a', 'guardian')).body.successes).toEqual([]);
  });
  it('keeps family input attributed and private, accepts exact revisions, and removes corrected input from memory', async () => {
    const content = { kind: 'home_strategy', strategy: 'Worked through one example together', observedOutcome: 'Completed the next example independently' };
    const input = { requestId: newId(), studentId: 'b', sectionId: 'section', recipientId: 'teacher', role: 'guardian', content };
    const casesBefore = (await handle.ctx.db.select().from(cases)).length;
    const first = await call('guardian', 'POST', '/api/pulse/contributions', input);
    expect(first.status).toBe(200);
    expect((await call('guardian', 'POST', '/api/pulse/contributions', input)).body.id).toBe(first.body.id);
    expect((await call('guardian', 'POST', '/api/pulse/contributions', { ...input, content: { ...content, strategy: 'Changed' } })).status).toBe(409);
    expect((await call('guardian', 'POST', '/api/pulse/contributions', { ...input, requestId: newId(), recipientId: 'other' })).status).toBe(403);
    expect((await call('guardian', 'POST', '/api/pulse/contributions', { ...input, requestId: newId(), content: { kind: 'strategy_choice', strategyId: 'foreign', experience: 'Helped with practice' } })).status).toBe(400);
    expect((await call('student', 'POST', '/api/pulse/contributions', { ...input, requestId: newId(), role: 'student', content: { kind: 'reflection', whatHappened: 'Practised a problem', whatHelped: '' } })).status).toBe(403);
    for (const who of ['coteacher', 'other', 'student', 'admin'] as const) expect((await call(who, 'GET', '/api/pulse/contributions?studentId=b&sectionId=section')).body).toEqual([]);
    expect((await profile('teacher', 'b', 'teacher')).body.acceptedContributions).toEqual([]);
    const response = { expectedRevision: 1, decision: 'accepted', response: 'Thank you. We will discuss this reported outcome at the next check-in.' };
    expect((await call('coteacher', 'POST', `/api/pulse/contributions/${first.body.id}/respond`, response)).status).toBe(403);
    expect((await call('teacher', 'POST', `/api/pulse/contributions/${first.body.id}/respond`, response)).status).toBe(200);
    expect((await profile('teacher', 'b', 'teacher')).body.acceptedContributions).toMatchObject([{ sourceRole: 'guardian', revision: 1, content }]);
    const authorView = await call('guardian', 'GET', '/api/pulse/contributions?studentId=b&sectionId=section');
    expect(authorView.body[0].response).toBe(response.response);
    const corrected = { requestId: newId(), expectedRevision: 1, content: { ...content, observedOutcome: 'Asked for help on the next example' } };
    expect((await call('guardian', 'POST', `/api/pulse/contributions/${first.body.id}/correct`, corrected)).body.revision).toBe(2);
    expect((await call('guardian', 'POST', `/api/pulse/contributions/${first.body.id}/correct`, corrected)).body.revision).toBe(2);
    expect((await profile('teacher', 'b', 'teacher')).body.acceptedContributions).toEqual([]);
    expect((await call('teacher', 'POST', `/api/pulse/contributions/${first.body.id}/respond`, response)).status).toBe(409);
    await call('teacher', 'POST', `/api/pulse/contributions/${first.body.id}/respond`, { ...response, expectedRevision: 2 });
    await call('guardian', 'POST', `/api/pulse/contributions/${first.body.id}/withdraw`, { expectedRevision: 2 });
    expect((await profile('teacher', 'b', 'teacher')).body.acceptedContributions).toEqual([]);
    expect((await handle.ctx.db.select().from(cases)).length).toBe(casesBefore);
  });
  it('routes help immediately without a case and expires unaccepted contribution content independently', async () => {
    const request = { requestId: newId(), studentId: 'b', sectionId: 'section', recipientId: 'teacher', role: 'guardian', description: 'Please check in before the next class.' };
    const help = await call('guardian', 'POST', '/api/pulse/help', request);
    expect(help.status).toBe(200);
    expect((await call('guardian', 'POST', '/api/pulse/help', request)).body.id).toBe(help.body.id);
    expect((await call('teacher', 'GET', '/api/pulse/help?sectionId=section')).body).toMatchObject([{ id: help.body.id, status: 'open', studentId: 'b' }]);
    expect((await call('coteacher', 'GET', '/api/pulse/help?sectionId=section')).body).toEqual([]);
    expect((await call('coteacher', 'POST', `/api/pulse/help/${help.body.id}/acknowledge`, {})).status).toBe(403);
    expect((await call('teacher', 'POST', `/api/pulse/help/${help.body.id}/acknowledge`, {})).status).toBe(200);
    const input = { requestId: newId(), studentId: 'a', sectionId: 'section', recipientId: 'teacher', role: 'student', content: { kind: 'proposal', proposedChange: 'Try a visual example', reason: 'It helped explain one step' } };
    const pending = await call('student', 'POST', '/api/pulse/contributions', input);
    expect(pending.status).toBe(200);
    const now = handle.ctx.now;
    try {
      handle.ctx.now = () => new Date(Date.now() + 31 * 86400000);
      await expireContributions(handle.ctx);
      expect((await call('student', 'POST', '/api/pulse/contributions', input)).status).toBe(409);
      expect((await call('student', 'GET', '/api/pulse/contributions?studentId=a&sectionId=section')).body).toEqual([]);
      expect((await call('teacher', 'POST', `/api/pulse/contributions/${pending.body.id}/respond`, { expectedRevision: 1, decision: 'accepted', response: 'Thank you' })).status).toBe(409);
    } finally { handle.ctx.now = now; }
    const [assignment] = await handle.ctx.db.select().from(roleAssignments).where(and(eq(roleAssignments.userId, 'guardian'), eq(roleAssignments.studentId, 'b')));
    await handle.ctx.db.delete(roleAssignments).where(eq(roleAssignments.id, assignment!.id));
    expect((await profile('guardian', 'b', 'guardian')).status).toBe(403);
    expect((await call('guardian', 'GET', '/api/pulse/people?role=guardian')).body.map((p: { id: string }) => p.id)).toEqual(['a']);
  });
});

describe('aggregate classroom insights', () => {
  it('counts unique learners with small-cell and complementary suppression and returns no individual details', async () => {
    for (const role of ['teacher', 'guardian', 'student', 'coteacher'] as const) expect((await call(role, 'GET', '/api/pulse/insights')).status).toBe(403);
    const small = await call('admin', 'GET', '/api/pulse/insights');
    expect(small.status).toBe(200);
    for (const name of ['participation', 'checkIns', 'instruction', 'followUps', 'documentation']) {
      expect(small.body[name].total).toBeNull();
      expect(small.body[name].cells.every((c: { count: number | null }) => c.count === null || c.count === 0)).toBe(true);
    }
    expect(small.body.participationTrend).toHaveLength(4);
    expect(small.body.participationTrend.every((w: { observed: number | null; suppressed: boolean }) => w.observed === null && w.suppressed)).toBe(true);
    for (const forbidden of ['studentId', 'learnerKey', 'Robin', 'Sample', 'Left seat', 'Worked through']) expect(JSON.stringify(small.body)).not.toContain(forbidden);
    const minimum = handle.ctx.config.adminMinCellSize;
    handle.ctx.config.adminMinCellSize = 2;
    try {
      await call('teacher', 'POST', '/api/pulse/events', capture());
      await call('teacher', 'POST', '/api/pulse/events', capture());
      const cohort = await call('admin', 'GET', '/api/pulse/insights');
      expect(cohort.body.participation.total).toBe(3);
      expect(cohort.body.participation.cells.filter((c: { suppressed: boolean }) => c.suppressed)).toHaveLength(2);
      expect(cohort.body.participation.cells.some((c: { reason: string }) => c.reason === 'complementary')).toBe(true);
    } finally { handle.ctx.config.adminMinCellSize = minimum; }
  });
});

describe('classroom-informed support-plan revisions', () => {
  it('preserves baselines, attributes input, blocks stale drafts and atomically applies a reviewed revision', async () => {
    const intake = await call('teacher', 'POST', '/api/intakes', { studentId: 'a', fields: EVAL_CASES[0]!.intake });
    expect(intake.status).toBe(202);
    await handle.ctx.queue.drain();
    const baseDraft = await call('teacher', 'GET', `/api/drafts/${intake.body.draftId}`);
    expect(baseDraft.body.content).toBeTruthy();
    const base = await call('teacher', 'POST', `/api/drafts/${intake.body.draftId}/approve`, { content: baseDraft.body.content, rationale: 'Reviewed all sections' });
    expect(base.status).toBe(200);
    const existingStrategy = { description: 'Offer a brief visual checklist.', rationale: 'Reviewed classroom support action.', usesStrengths: [], effortLevel: 'low' };
    expect((await call('teacher', 'POST', `/api/plans/${base.body.planId}/strategies`, { kind: 'preventive', content: existingStrategy })).status).toBe(200);
    const contribution = await call('guardian', 'POST', '/api/pulse/contributions', { requestId: newId(), studentId: 'a', sectionId: 'section', recipientId: 'teacher', role: 'guardian', content: { kind: 'proposal', proposedChange: 'Try a visual worked example', reason: 'We used a diagram during homework' } });
    expect(contribution.status).toBe(200);
    expect((await call('teacher', 'POST', `/api/pulse/contributions/${contribution.body.id}/respond`, { expectedRevision: 1, decision: 'accepted', response: 'We can discuss trying this strategy.' })).status).toBe(200);
    const event = await call('teacher', 'POST', '/api/pulse/events', capture());
    const input = { requestId: newId(), caseKey: intake.body.caseKey, basePlanId: base.body.planId, sources: [{ kind: 'contribution', id: contribution.body.id, revision: 1 }, { kind: 'event', id: event.body.id, revision: 1 }], strategySection: 'parentGuardianSupport', description: 'Offer a visual worked example before independent practice.', rationale: 'A proposed adjustment informed by an attributed family report and classroom observation.' };
    const draft = await call('teacher', 'POST', '/api/pulse/plan-revisions', input);
    expect(draft.status).toBe(200);
    expect((await call('teacher', 'POST', '/api/pulse/plan-revisions', input)).body.draftId).toBe(draft.body.draftId);
    const proposed = await call('teacher', 'GET', `/api/drafts/${draft.body.draftId}`);
    expect(proposed.body.content.measurableGoals).toEqual(baseDraft.body.content.measurableGoals);
    expect(proposed.body.content.preventiveStrategies).toContainEqual(existingStrategy);
    expect(proposed.body.classroomOrigin.evidence.map((e: { reportedBy: string }) => e.reportedBy)).toEqual(['guardian', 'teacher']);
    expect((await call('coteacher', 'GET', `/api/drafts/${draft.body.draftId}`)).status).toBe(403);
    expect((await call('coteacher', 'GET', `/api/cases/${intake.body.caseKey}/drafts`)).body.some((d: { id: string }) => d.id === draft.body.draftId)).toBe(false);
    expect((await call('teacher', 'POST', `/api/drafts/${draft.body.draftId}/regenerate`, {})).status).toBe(409);
    await call('teacher', 'POST', `/api/pulse/events/${event.body.id}/revise`, { requestId: newId(), expectedRevision: 1, studentId: 'a', observation: { ...participation, action: 'asked_question' }, reason: 'Action clarified', confirmed: true });
    expect((await call('teacher', 'GET', `/api/drafts/${draft.body.draftId}`)).status).toBe(409);
    expect((await call('teacher', 'POST', `/api/drafts/${draft.body.draftId}/approve`, { content: proposed.body.content, rationale: 'Reviewed' })).status).toBe(409);
    const baseEditDraft = await call('teacher', 'POST', '/api/pulse/plan-revisions', { ...input, requestId: newId(), sources: [input.sources[0], { ...input.sources[1], revision: 2 }] });
    expect(baseEditDraft.status).toBe(200);
    const additionalStrategy = { ...existingStrategy, description: 'Provide a short written example.' };
    await call('teacher', 'POST', `/api/plans/${base.body.planId}/strategies`, { kind: 'preventive', content: additionalStrategy });
    expect((await call('teacher', 'GET', `/api/drafts/${baseEditDraft.body.draftId}`)).status).toBe(409);
    const refreshed = await call('teacher', 'POST', '/api/pulse/plan-revisions', { ...input, requestId: newId(), sources: [input.sources[0], { ...input.sources[1], revision: 2 }] });
    expect(refreshed.status).toBe(200);
    const reviewed = await call('teacher', 'GET', `/api/drafts/${refreshed.body.draftId}`);
    expect(reviewed.body.content.preventiveStrategies).toContainEqual(additionalStrategy);
    const [a, b] = await Promise.all([call('teacher', 'POST', `/api/drafts/${refreshed.body.draftId}/approve`, { content: reviewed.body.content, rationale: 'Reviewed the family report and confirmed observation' }), call('teacher', 'POST', `/api/drafts/${refreshed.body.draftId}/approve`, { content: reviewed.body.content, rationale: 'Reviewed the family report and confirmed observation' })]);
    expect(a.status).toBe(200); expect(b.body.planId).toBe(a.body.planId);
    const familyView = await call('guardian', 'GET', `/api/cases/${intake.body.caseKey}`);
    expect(familyView.body.plan_parentGuardianSupport.at(-1).description).toBe(input.description);
    expect(familyView.body.plan_provenance.version).toBe(2);
    const authorView = await call('guardian', 'GET', '/api/pulse/contributions?sectionId=section&studentId=a');
    expect(authorView.body.find((c: { id: string }) => c.id === contribution.body.id).usedInPlanVersion).toBe(2);
    await call('guardian', 'POST', `/api/pulse/contributions/${contribution.body.id}/withdraw`, { expectedRevision: 1 });
    const changed = await call('teacher', 'GET', `/api/cases/${intake.body.caseKey}`);
    expect(changed.body.plan_provenance.sourceReviewNeeded).toBe(true);
    const resolve = { expectedUpdatedAt: changed.body.plan_provenance.updatedAt, rationale: 'Reviewed the withdrawn report. Retaining this strategy while collecting new classroom observations.' };
    expect((await call('guardian', 'POST', `/api/plans/${a.body.planId}/source-review`, resolve)).status).toBe(403);
    expect((await call('teacher', 'POST', `/api/plans/${a.body.planId}/source-review`, resolve)).status).toBe(200);
    expect((await call('teacher', 'GET', `/api/cases/${intake.body.caseKey}`)).body.plan_provenance.sourceReviewNeeded).toBe(false);
    const now = handle.ctx.now;
    try {
      handle.ctx.now = () => new Date(Date.now() + 31 * 86400000);
      await expirePendingClassroomContent(handle.ctx);
      const expired = await call('teacher', 'GET', `/api/drafts/${draft.body.draftId}`);
      expect(expired.body.status).toBe('discarded');
      expect(expired.body.content).toBeNull();
      expect((await call('teacher', 'GET', `/api/drafts/${refreshed.body.draftId}`)).body.content).toEqual(reviewed.body.content);
    } finally { handle.ctx.now = now; }
  });
});

describe('instructional groups, evidence reports, and follow-ups', () => {
  it('requires reviewed evidence for 2–8 learners on one concept and explicit teacher-only group approval', async () => {
    const observation = { kind: 'understanding', concept: 'Fractions', evidence: 'needs_practice', note: '' };
    const a = await call('teacher', 'POST', '/api/pulse/events', capture({ observation }));
    const b = await call('teacher', 'POST', '/api/pulse/events', capture({ studentId: 'b', observation }));
    const sources = [a, b].map((e) => ({ eventId: e.body.id, revision: 1 }));
    expect((await call('teacher', 'POST', '/api/pulse/drafts', { sessionId, kind: 'small_group', sources: sources.slice(0, 1) })).status).toBe(400);
    expect((await call('teacher', 'POST', '/api/pulse/drafts', { sessionId, kind: 'sst_report', sources })).status).toBe(400);
    const unchecked = await call('teacher', 'POST', '/api/pulse/events', capture({ studentId: 'b', observation: { ...observation, evidence: 'not_checked' } }));
    expect((await call('teacher', 'POST', '/api/pulse/drafts', { sessionId, kind: 'small_group', sources: [sources[0], { eventId: unchecked.body.id, revision: 1 }] })).status).toBe(400);
    const draft = await call('teacher', 'POST', '/api/pulse/drafts', { sessionId, kind: 'small_group', sources });
    expect(draft.status).toBe(200);
    await handle.ctx.queue.drain();
    const read = await call('teacher', 'GET', `/api/pulse/drafts/${draft.body.id}`);
    expect(read.body.draft.generationState).toBe('ready');
    expect(read.body.sourceContext.map((s: { studentId: string }) => s.studentId).sort()).toEqual(['a', 'b']);
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/approve`, { expectedRevision: 1, audience: 'family' })).status).toBe(400);
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/approve`, { expectedRevision: 1, audience: 'teacher' })).status).toBe(200);
    await call('teacher', 'POST', '/api/pulse/events', capture({ observation }));
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/export`, {})).status).toBe(409);
  });

  it('preserves report evidence, provides Guide actions, and approves retry-safe private follow-ups', async () => {
    const source = await call('teacher', 'POST', '/api/pulse/events', capture({ observation: { kind: 'behavior', action: 'Left seat', antecedent: null, consequence: null, measuredCount: 0, note: '' } }));
    const input = { sessionId, kind: 'fba_observations', sources: [{ eventId: source.body.id, revision: 1 }] };
    const draft = await call('teacher', 'POST', '/api/pulse/drafts', input);
    const guide = await call('teacher', 'POST', '/api/pulse/drafts', { ...input, kind: 'guide_next_step' });
    await handle.ctx.queue.drain();
    expect((await call('teacher', 'GET', `/api/pulse/drafts/${guide.body.id}`)).body.draft.generationState).toBe('ready');
    const detail = await call('teacher', 'GET', `/api/pulse/drafts/${draft.body.id}`);
    const content = detail.body.revisions[0].content;
    expect(content.observations[0]).toContain('measuredCount: 0');
    expect(content.observations[0]).toContain('antecedent: Not recorded');
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/edit`, { expectedRevision: 1, content: { ...content, observations: ['Invented observation'] } })).status).toBe(400);
    const taskInput = { requestId: newId(), draftId: draft.body.id, artifactRevision: 1, kind: 'intervention_review', title: 'Review classroom observations', action: 'Collect another observation and review the evidence with the team.', dueDate: '2026-09-01', confirmed: true };
    expect((await call('teacher', 'POST', '/api/pulse/follow-ups', taskInput)).status).toBe(409);
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/approve`, { expectedRevision: 1, audience: 'teacher' })).status).toBe(200);
    const exported = await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/export`, {});
    expect(exported.body.templateStatus).toBe('template_pending_educator_validation');
    expect(exported.body.template).toEqual({ validation: null });
    expect(exported.body.evidence).toHaveLength(1);
    const validate = { schoolId: 'school', kind: detail.body.draft.kind, validated: true, notes: 'Reviewed against our SST intake form.' };
    expect((await call('teacher', 'POST', '/api/pulse/report-templates', validate)).status).toBe(403);
    expect((await call('admin', 'POST', '/api/pulse/report-templates', validate)).status).toBe(200);
    const validated = await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/export`, {});
    expect(validated.body.templateStatus).toBeNull();
    expect(validated.body.template.validation).toMatchObject({ name: 'admin', role: 'administrator', notes: 'Reviewed against our SST intake form.' });
    expect((await call('teacher', 'GET', '/api/pulse/report-templates')).body[0]).toMatchObject({ schoolId: 'school', canValidate: false });
    await call('admin', 'POST', '/api/pulse/report-templates', { ...validate, validated: false });
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${draft.body.id}/export`, {})).body.template).toEqual({ validation: null });
    expect(exported.body.publication.approverName).toBe('teacher');
    const [first, retry] = await Promise.all([call('teacher', 'POST', '/api/pulse/follow-ups', taskInput), call('teacher', 'POST', '/api/pulse/follow-ups', taskInput)]);
    expect(first.status).toBe(200); expect(retry.body.id).toBe(first.body.id);
    expect(await handle.ctx.db.select().from(followUpTasks).where(eq(followUpTasks.draftId, draft.body.id))).toHaveLength(1);
    expect((await call('teacher', 'POST', '/api/pulse/follow-ups', { ...taskInput, title: 'Different' })).status).toBe(409);
    expect((await call('teacher', 'POST', '/api/pulse/follow-ups', { ...taskInput, requestId: newId(), ownerId: 'other' })).status).toBe(400);
    for (const who of ['guardian', 'student', 'other', 'coteacher', 'admin'] as const) {
      expect((await call(who, 'GET', '/api/pulse/follow-ups')).body).toEqual([]);
      expect((await call(who, 'POST', `/api/pulse/follow-ups/${first.body.id}`, { expectedRevision: 1, status: 'completed' })).status).toBe(403);
    }
    const list = await call('teacher', 'GET', '/api/pulse/follow-ups');
    expect(list.body.find((t: { id: string }) => t.id === first.body.id).due).toBe(true);
    const finished = { expectedRevision: 1, status: 'completed' };
    expect((await call('teacher', 'POST', `/api/pulse/follow-ups/${first.body.id}`, finished)).body.revision).toBe(2);
    expect((await call('teacher', 'POST', `/api/pulse/follow-ups/${first.body.id}`, finished)).body.revision).toBe(2);
    const second = await call('teacher', 'POST', '/api/pulse/follow-ups', { ...taskInput, requestId: newId() });
    await call('teacher', 'POST', `/api/pulse/events/${source.body.id}/revise`, { requestId: newId(), expectedRevision: 1, studentId: 'a', observation: { kind: 'behavior', action: 'Left seat', antecedent: null, consequence: null, measuredCount: 2, note: '' }, reason: 'Count corrected', confirmed: true });
    const changed = (await call('teacher', 'GET', '/api/pulse/follow-ups')).body.find((t: { id: string }) => t.id === second.body.id);
    expect(changed).toMatchObject({ status: 'needs_review', action: '', sourceChanged: true });
    expect((await call('teacher', 'POST', `/api/pulse/follow-ups/${second.body.id}`, finished)).status).toBe(409);
    expect((await call('teacher', 'POST', `/api/pulse/follow-ups/${second.body.id}`, { expectedRevision: 1, status: 'cancelled' })).status).toBe(200);
  });
});

describe('explicit event-to-case projection', () => {
  it('invalidates review recommendations after withdrawal and requires the refreshed evidence version', async () => {
    const available = await call('teacher', 'GET', '/api/cases');
    const active = available.body.find((c: { plan?: { status: string } }) => c.plan?.status === 'active');
    expect(active).toBeTruthy();
    const event = await call('teacher', 'POST', '/api/pulse/events', capture({ observation: { kind: 'behavior', action: 'Left seat', antecedent: null, consequence: null, measuredCount: 2, note: '' } }));
    expect((await call('teacher', 'POST', `/api/pulse/events/${event.body.id}/project`, { expectedRevision: 1, caseKey: active.caseKey, goalId: null, strategyId: null })).status).toBe(200);
    const opened = await call('teacher', 'POST', `/api/plans/${active.plan.id}/review-now`, {});
    expect(opened.status).toBe(200);
    await handle.ctx.queue.drain();
    const path = `/api/reviews/${opened.body.cycleId}`;
    const before = await call('teacher', 'GET', path);
    expect(before.body.computed).toBeTruthy();
    expect(before.body.narrative).toBeTruthy();
    await call('teacher', 'POST', `/api/pulse/events/${event.body.id}/withdraw`, { expectedRevision: 1 });
    const invalid = await call('teacher', 'GET', path);
    expect(invalid.body.sourceInvalidatedAt).toBeTruthy();
    expect(invalid.body.computed).toBeNull();
    expect(invalid.body.narrative).toBeNull();
    const decision = { decision: 'collect_more', rationale: 'Collect current observations before changing support', expectedEvidenceVersion: before.body.evidenceVersion };
    expect((await call('teacher', 'POST', `${path}/decide`, decision)).status).toBe(409);
    expect((await call('teacher', 'POST', `${path}/refresh`, {})).status).toBe(200);
    await handle.ctx.queue.drain();
    const refreshed = await call('teacher', 'GET', path);
    expect(refreshed.body.sourceInvalidatedAt).toBeNull();
    expect(refreshed.body.evidenceVersion).toBeGreaterThan(before.body.evidenceVersion);
    expect(refreshed.body.computed).toBeTruthy();
    expect((await call('teacher', 'POST', `${path}/decide`, decision)).status).toBe(409);
    expect((await call('teacher', 'POST', `${path}/decide`, { ...decision, expectedEvidenceVersion: refreshed.body.evidenceVersion })).status).toBe(200);
  });
  it('preserves a measured zero, deduplicates projection, and retires it after correction', async () => {
    await handle.ctx.db.insert(cases).values({ caseKey: 'projection-case', sectionId: 'section', schoolId: 'school', gradeLevel: '6' });
    await handle.ctx.db.insert(caseLinks).values({ caseKey: 'projection-case', studentId: 'a', createdBy: 'teacher' });
    const observation = { kind: 'behavior', action: 'Left seat', antecedent: null, consequence: null, measuredCount: 0, note: '' };
    const event = await call('teacher', 'POST', '/api/pulse/events', capture({ observation }));
    const path = '/api/pulse/events/' + event.body.id + '/project';
    const input = { expectedRevision: 1, caseKey: 'projection-case', goalId: null, strategyId: null };
    const a = await call('teacher', 'POST', path, input);
    expect(a.status).toBe(200);
    expect((await call('teacher', 'POST', path, input)).body.signalId).toBe(a.body.signalId);
    expect((await call('teacher', 'POST', path, { ...input, goalId: 'foreign' })).status).toBe(400);
    expect(await handle.ctx.db.select().from(signalProjections).where(eq(signalProjections.eventId, event.body.id))).toHaveLength(1);
    const [signal] = await handle.ctx.db.select().from(signals).where(eq(signals.id, a.body.signalId));
    expect(signal!.valueNum).toBe(0);
    expect((await call('teacher', 'GET', '/api/cases/projection-case/signals')).body).toHaveLength(1);
    await call('teacher', 'POST', '/api/pulse/events/' + event.body.id + '/revise', { requestId: newId(), expectedRevision: 1, studentId: 'a', observation: { ...observation, measuredCount: 2 }, reason: 'Count corrected', confirmed: true });
    expect((await call('teacher', 'GET', '/api/cases/projection-case/signals')).body).toHaveLength(0);
    const b = await call('teacher', 'POST', path, { ...input, expectedRevision: 2 });
    expect(b.status).toBe(200);
    const recent = await call('teacher', 'GET', '/api/cases/projection-case/signals');
    expect(recent.body).toHaveLength(1); expect(recent.body[0].value).toBe(2);
  });
  it('rejects praise, unmeasured behavior and a different learner destination', async () => {
    const input = { expectedRevision: 1, caseKey: 'projection-case', goalId: null, strategyId: null };
    for (const observation of [participation, { kind: 'behavior', action: 'Left seat', antecedent: null, consequence: null, measuredCount: null, note: '' }]) {
      const event = await call('teacher', 'POST', '/api/pulse/events', capture({ observation }));
      expect((await call('teacher', 'POST', '/api/pulse/events/' + event.body.id + '/project', input)).status).toBe(400);
    }
    const other = await call('teacher', 'POST', '/api/pulse/events', capture({ studentId: 'b', observation: { kind: 'attendance', status: 'present', note: '' } }));
    expect((await call('teacher', 'POST', '/api/pulse/events/' + other.body.id + '/project', input)).status).toBe(400);
  });
});

describe('Tomorrow Ready bundle', () => {
  it('prepares Do Now, reteach and a practice group from needs-practice evidence, idempotently', async () => {
    const session = await call('teacher', 'POST', '/api/pulse/sessions', { requestId: newId(), sectionId: 'section', date: '2026-12-01', topic: 'Ratios', objective: 'Compare ratios', contextTags: [] });
    const at = (studentId: string, observation: Record<string, unknown>) => call('teacher', 'POST', '/api/pulse/events', { requestId: newId(), sessionId: session.body.id, studentId, source: 'teacher_tap', observedAt: new Date().toISOString(), observation, confirmed: true });
    await at('a', { kind: 'understanding', concept: 'Ratios', evidence: 'needs_practice', note: '' });
    await at('b', { kind: 'understanding', concept: 'ratios', evidence: 'needs_practice', note: '' });
    await at('a', { kind: 'praise', strength: 'Explained their reasoning', note: '' });
    const first = await call('teacher', 'POST', '/api/pulse/tomorrow/section/prepare', {});
    expect(first.body.requested).toEqual(['do_now', 'reteach', 'small_group']);
    const bundle = await call('teacher', 'GET', '/api/pulse/tomorrow/section/bundle');
    expect(bundle.status).toBe(200);
    expect(bundle.body.session).toMatchObject({ date: '2026-12-01', confirmedCount: 3, needsPractice: 2 });
    expect(bundle.body.instructional.map((d: { kind: string }) => d.kind).sort()).toEqual(['do_now', 'reteach', 'small_group']);
    expect(bundle.body.targetDate > '2026-12-01').toBe(true);
    expect(bundle.body.family.candidates).toEqual([expect.objectContaining({ studentId: 'a', draftId: null })]);
    await call('teacher', 'POST', '/api/pulse/tomorrow/section/prepare', {});
    const again = await call('teacher', 'GET', '/api/pulse/tomorrow/section/bundle');
    expect(again.body.instructional.map((d: { id: string }) => d.id).sort()).toEqual(bundle.body.instructional.map((d: { id: string }) => d.id).sort());
    expect((await call('guardian', 'GET', '/api/pulse/tomorrow/section/bundle')).status).toBe(403);
  });
});

describe('Family Pulse collection policy and visibility', () => {
  const submit = (who: 'guardian' | 'student', content: Record<string, unknown>, visibility?: string) => call(who, 'POST', '/api/pulse/contributions', { requestId: newId(), studentId: 'a', sectionId: 'section', recipientId: 'teacher', role: who, content, ...(visibility ? { visibility } : {}) });
  it('accepts sleep and mood only while the school collects them', async () => {
    expect((await call('guardian', 'GET', '/api/pulse/people/a?role=guardian&sectionId=section')).body.collection).toEqual({ wellbeing: true });
    expect((await submit('guardian', { kind: 'sleep', quality: 'somewhat_tired', hours: 7.5, note: '' })).status).toBe(200);
    expect((await call('admin', 'POST', '/api/pulse/settings/wellbeing', { schoolId: 'school', enabled: false })).status).toBe(200);
    expect((await submit('guardian', { kind: 'mood', description: 'Quiet before school', note: '' })).status).toBe(400);
    expect((await call('teacher', 'POST', '/api/pulse/settings/wellbeing', { schoolId: 'school', enabled: true })).status).toBe(403);
    await call('admin', 'POST', '/api/pulse/settings/wellbeing', { schoolId: 'school', enabled: true });
    expect((await submit('student', { kind: 'sleep', quality: 'rested', hours: null, note: '' })).status).toBe(400);
  });
  it('shows a family item to the student only when the family shares it, read-only', async () => {
    const shared = await submit('guardian', { kind: 'home_strategy', strategy: 'Practised one example together', observedOutcome: 'Finished the next one alone' }, 'teacher_and_student');
    const privateItem = await submit('guardian', { kind: 'family_observation', observation: 'Busy week at home', context: '' });
    expect((await submit('student', { kind: 'reflection', whatHappened: 'Tried the example', whatHelped: '' }, 'teacher_and_student')).status).toBe(400);
    const seen = (await call('student', 'GET', '/api/pulse/contributions?studentId=a&sectionId=section')).body as Array<{ id: string; own: boolean; sharedView: boolean }>;
    expect(seen.find((c) => c.id === shared.body.id)).toMatchObject({ own: false, sharedView: true });
    expect(seen.some((c) => c.id === privateItem.body.id)).toBe(false);
    expect((await call('student', 'POST', `/api/pulse/contributions/${shared.body.id}/withdraw`, { expectedRevision: 1 })).status).toBe(403);
  });
});

describe('Guide and reports across a learner’s history', () => {
  it('lets history kinds cite several sessions of one class, keeps lesson kinds to one session, and support to one student', async () => {
    const open = async (date: string) => (await call('teacher', 'POST', '/api/pulse/sessions', { requestId: newId(), sectionId: 'section', date, topic: 'Area', objective: '', contextTags: [] })).body.id as string;
    const [s1, s2] = [await open('2026-11-02'), await open('2026-11-03')];
    const event = async (sessionId: string, studentId: string) => (await call('teacher', 'POST', '/api/pulse/events', { requestId: newId(), sessionId, studentId, source: 'teacher_tap', observedAt: new Date().toISOString(), observation: { kind: 'check_in', observation: 'Asked for the directions again', note: '' }, confirmed: true })).body as { id: string; revision: number };
    const [a1, a2, b2] = [await event(s1, 'a'), await event(s2, 'a'), await event(s2, 'b')];
    const ref = (e: { id: string; revision: number }) => ({ eventId: e.id, revision: e.revision });
    const support = await call('teacher', 'POST', '/api/pulse/drafts', { sessionId: s2, kind: 'support_recommendation', sources: [ref(a1), ref(a2)] });
    expect(support.status).toBe(200);
    await handle.ctx.queue.drain();
    const ready = await call('teacher', 'GET', `/api/pulse/drafts/${support.body.id}`);
    expect(ready.body.draft.generationState).toBe('ready');
    expect(ready.body.revisions[0].content.options.length).toBeGreaterThanOrEqual(2);
    expect((await call('teacher', 'POST', `/api/pulse/drafts/${support.body.id}/approve`, { expectedRevision: 1, audience: 'teacher' })).status).toBe(200);
    const profile = await call('teacher', 'GET', '/api/pulse/people/a?role=teacher&sectionId=section');
    expect(profile.body.interventions.supports).toEqual(expect.arrayContaining([expect.objectContaining({ draftId: support.body.id, kind: 'support_recommendation' })]));
    expect((await call('guardian', 'GET', '/api/pulse/people/a?role=guardian&sectionId=section')).body.interventions).toBeNull();
    expect((await call('teacher', 'POST', '/api/pulse/drafts', { sessionId: s2, kind: 'sst_report', sources: [ref(a1), ref(a2)] })).status).toBe(200);
    expect((await call('teacher', 'POST', '/api/pulse/drafts', { sessionId: s2, kind: 'do_now', sources: [ref(a1), ref(a2)] })).status).toBe(409);
    expect((await call('teacher', 'POST', '/api/pulse/drafts', { sessionId: s2, kind: 'support_recommendation', sources: [ref(a2), ref(b2)] })).status).toBe(400);
  });
});

describe('bulk Teacher Confirm', () => {
  it('approves each exact version through the single-item path and reports failures per item', async () => {
    const session = (await call('teacher', 'POST', '/api/pulse/sessions', { requestId: newId(), sectionId: 'section', date: '2026-11-10', topic: 'Volume', objective: '', contextTags: [] })).body.id as string;
    const make = async (strength: string) => {
      const e = (await call('teacher', 'POST', '/api/pulse/events', { requestId: newId(), sessionId: session, studentId: 'b', source: 'teacher_tap', observedAt: new Date().toISOString(), observation: { kind: 'praise', strength, note: '' }, confirmed: true })).body;
      return (await call('teacher', 'POST', '/api/pulse/drafts', { sessionId: session, kind: 'positive_note', sources: [{ eventId: e.id, revision: e.revision }] })).body.id as string;
    };
    const [one, two] = [await make('Helped a classmate'), await make('Explained their reasoning')];
    await handle.ctx.queue.drain();
    const result = await call('teacher', 'POST', '/api/pulse/drafts/bulk', { decision: 'approve', items: [{ id: one, expectedRevision: 1 }, { id: two, expectedRevision: 3 }] });
    expect(result.body.results).toEqual([{ id: one, ok: true }, expect.objectContaining({ id: two, ok: false })]);
    const [a, b] = [await call('teacher', 'GET', `/api/pulse/drafts/${one}`), await call('teacher', 'GET', `/api/pulse/drafts/${two}`)];
    expect(a.body.draft.reviewState).toBe('approved'); expect(a.body.publications[0].audience).toBe('teacher');
    expect(b.body.draft.reviewState).toBe('suggested');
    expect((await call('guardian', 'POST', '/api/pulse/drafts/bulk', { decision: 'discard', items: [{ id: two, expectedRevision: 1 }] })).body.results[0].ok).toBe(false);
  });
});

describe('retention policy, portability and erasure', () => {
  it('applies the school’s pending-retention window to new drafts', async () => {
    expect((await call('teacher', 'POST', '/api/pulse/settings/retention', { schoolId: 'school', pendingRetentionDays: 5, memoryWindowDays: 90 })).status).toBe(403);
    expect((await call('admin', 'POST', '/api/pulse/settings/retention', { schoolId: 'school', pendingRetentionDays: 5, memoryWindowDays: 90 })).status).toBe(200);
    const session = (await call('teacher', 'POST', '/api/pulse/sessions', { requestId: newId(), sectionId: 'section', date: '2026-11-20', topic: 'Graphs', objective: '', contextTags: [] })).body.id as string;
    const e = (await call('teacher', 'POST', '/api/pulse/events', { requestId: newId(), sessionId: session, studentId: 'a', source: 'teacher_tap', observedAt: new Date().toISOString(), observation: participation, confirmed: true })).body;
    const draft = (await call('teacher', 'POST', '/api/pulse/drafts', { sessionId: session, kind: 'positive_note', sources: [{ eventId: e.id, revision: e.revision }] })).body.id as string;
    const [row] = await handle.ctx.db.select().from(classroomDrafts).where(eq(classroomDrafts.id, draft));
    const days = (row!.expiresAt.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(4.9); expect(days).toBeLessThan(5.1);
    expect((await call('teacher', 'GET', '/api/pulse/people/a?role=teacher&sectionId=section')).body.memoryWindowDays).toBe(90);
    await call('admin', 'POST', '/api/pulse/settings/retention', { schoolId: 'school', pendingRetentionDays: 30, memoryWindowDays: 120 });
  });
  it('exports one learner’s record and erases it only for an administrator who types the name', async () => {
    expect((await call('teacher', 'GET', '/api/pulse/learners/b/export')).status).toBe(403);
    const exported = await call('admin', 'GET', '/api/pulse/learners/b/export');
    expect(exported.body.format).toBe('pulsera.learner-record.v1');
    expect(exported.body.observations.length).toBeGreaterThan(0);
    expect(JSON.stringify(exported.body)).not.toContain('Robin');
    expect((await call('admin', 'POST', '/api/pulse/learners/b/erase', { confirm: 'Casey' })).status).toBe(400);
    const erased = await call('admin', 'POST', '/api/pulse/learners/b/erase', { confirm: 'Casey Example' });
    expect(erased.status).toBe(200);
    expect(erased.body.observations).toBeGreaterThan(0);
    const [link] = await handle.ctx.db.select().from(learnerLinks).where(eq(learnerLinks.studentId, 'b'));
    expect(await handle.ctx.db.select().from(eventRevisions).where(eq(eventRevisions.learnerKey, link!.learnerKey))).toHaveLength(0);
    const after = await call('admin', 'GET', '/api/pulse/learners/b/export');
    expect(after.body.observations).toHaveLength(0); expect(after.body.approvedArtifacts).toHaveLength(0);
    const [entry] = await handle.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'learner.erase'));
    expect(JSON.stringify(entry!.metadata)).not.toContain('Helped a classmate');
  });
});

describe('voice capture behind an approved provider boundary', () => {
  const audio = Buffer.from('synthetic-audio-bytes-not-a-real-recording');
  const transcribe = (who: 'teacher' | 'guardian') => server.inject({ method: 'POST', url: '/api/pulse/voice/transcribe?sectionId=section', headers: { authorization: `Test ${ids[who]}`, 'content-type': 'audio/webm' }, payload: audio });
  it('stays off until a school approval is recorded, then transcribes without retaining audio', async () => {
    expect((await call('teacher', 'GET', '/api/pulse/voice/status?sectionId=section')).body.enabled).toBe(false);
    expect((await transcribe('teacher')).statusCode).toBe(409);
    expect((await call('teacher', 'POST', '/api/pulse/voice/approvals', { schoolId: 'school', approved: true, provider: 'OpenAI', approvedByName: 'Dr. Lee', approvedByTitle: 'Data protection lead', policyReference: 'Policy 4.2' })).status).toBe(403);
    expect((await call('admin', 'POST', '/api/pulse/voice/approvals', { schoolId: 'school', approved: true, provider: 'OpenAI' })).status).toBe(400);
    expect((await call('admin', 'POST', '/api/pulse/voice/approvals', { schoolId: 'school', approved: true, provider: 'OpenAI', approvedByName: 'Dr. Lee', approvedByTitle: 'Data protection lead', policyReference: 'Policy 4.2' })).status).toBe(200);
    expect((await call('teacher', 'GET', '/api/pulse/voice/status?sectionId=section')).body).toMatchObject({ enabled: true, approval: { provider: 'OpenAI', approvedBy: 'Dr. Lee, Data protection lead' } });
    const res = await transcribe('teacher');
    expect(res.statusCode).toBe(200);
    expect(res.json().transcript).toContain('partner');
    const [log] = await handle.ctx.db.select().from(egressLog).where(eq(egressLog.surface, 'voice_transcription'));
    expect(log!.input).toContain('not retained');
    expect(log!.input).not.toContain('synthetic-audio');
    expect((await transcribe('guardian')).statusCode).toBe(403);
    await call('admin', 'POST', '/api/pulse/voice/approvals', { schoolId: 'school', approved: false });
    expect((await call('teacher', 'GET', '/api/pulse/voice/status?sectionId=section')).body.enabled).toBe(false);
  });
});
