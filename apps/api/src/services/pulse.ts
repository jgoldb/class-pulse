import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { CaptureEvent, ReviseEvent, SessionInput, SeatingInput, newId, type AuditAction } from '@class-pulse/domain';
import { canReadClassroomRecord } from '@class-pulse/policy';
import { detectPii, hasHighConfidencePii } from '@class-pulse/ai/pii';
import type { Actor, AppContext } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import type { Db } from '../db/client';
import { cases, caseLinks, classSections, classSessions, classroomEvents, eventRevisions, learnerLinks, learners, organizations, schools, seatingLayouts, sectionEnrollments, students } from '../db/schema';
import { audit } from './audit';
import { teacherSections } from './classroom';
import { invalidateEventArtifacts, invalidateSessionActivities } from './pulse-lineage';
import { rejectExpiredRequest } from './classroom-receipts';
import { daysAgo, retentionFor } from './learner-records';

const hash = (input: unknown) => createHash('sha256').update(JSON.stringify(input)).digest('hex');
function trail(db: Db, actor: Actor, action: AuditAction, targetType: string, targetId: string, metadata: Record<string, unknown> = {}) {
  return audit(db, { actorUserId: actor.userId, actorRole: 'teacher', action, targetType, targetId, metadata });
}

export async function pulseSections(ctx: AppContext, actor: Actor) {
  const sections = await teacherSections(ctx.db, actor);
  if (!sections.length) return [];
  const settings = await ctx.db.select({ schoolId: schools.id, timezone: schools.timezone, enabled: organizations.pulseraEnabled }).from(schools).innerJoin(organizations, eq(schools.orgId, organizations.id)).where(inArray(schools.id, sections.map((s) => s.schoolId)));
  return sections.map((s) => ({ ...s, timezone: settings.find((x) => x.schoolId === s.schoolId)!.timezone, enabled: ctx.config.deploymentPosture === 'demonstration' && settings.some((x) => x.schoolId === s.schoolId && x.enabled) }));
}
export async function requirePulse(ctx: AppContext, actor: Actor, sectionId: string) {
  const section = (await pulseSections(ctx, actor)).find((s) => s.id === sectionId);
  if (!section) throw forbidden('Section is outside your teaching assignment');
  if (!section.enabled) throw conflict('Pulsera classroom capture is not enabled for this synthetic workspace');
  return section;
}

export async function configurePulse(ctx: AppContext, actor: Actor, schoolId: string, enabled: boolean, timezone: string) {
  if (!actor.scope.adminSchoolIds.has(schoolId)) throw forbidden('School is outside your administration');
  try { new Intl.DateTimeFormat('en', { timeZone: timezone }); } catch { throw badRequest('Choose a valid IANA school timezone'); }
  if (enabled && ctx.config.deploymentPosture !== 'demonstration') throw conflict('School approvals and operational readiness are still outstanding; enable only in demonstration posture');
  const [school] = await ctx.db.select().from(schools).where(eq(schools.id, schoolId));
  if (!school) throw notFound('School not found');
  // A workspace switch affects every school in it. Require authority over all of them.
  const orgSchools = await ctx.db.select().from(schools).where(eq(schools.orgId, school.orgId));
  if (orgSchools.some((s) => !actor.scope.adminSchoolIds.has(s.id))) throw forbidden('Workspace configuration requires administration of every school in the workspace');
  if (enabled) {
    const real = await ctx.db.select({ id: students.id }).from(students).where(and(inArray(students.schoolId, orgSchools.map((s) => s.id)), eq(students.synthetic, false))).limit(1);
    if (real.length) throw conflict('This workspace contains non-synthetic learners');
  }
  await ctx.db.transaction(async (tx) => {
    await tx.update(organizations).set({ pulseraEnabled: enabled }).where(eq(organizations.id, school.orgId));
    await tx.update(schools).set({ timezone }).where(eq(schools.id, schoolId));
    await audit(tx, { actorUserId: actor.userId, actorRole: 'administrator', action: 'classroom.configure', targetType: 'organization', targetId: school.orgId, metadata: { enabled, schoolId, timezone } });
  });
  return { enabled, timezone };
}

/** Caller holds the section lock. New learner keys never leave the protected lookup boundary. */
export async function learnerFor(db: Db, actor: Actor, sectionId: string, studentId: string, role: 'teacher' | 'student' | 'guardian' = 'teacher') {
  const [student] = await db.select({ id: students.id, synthetic: students.synthetic }).from(students).innerJoin(sectionEnrollments, eq(students.id, sectionEnrollments.studentId)).innerJoin(classSections, eq(sectionEnrollments.sectionId, classSections.id)).where(and(eq(students.id, studentId), eq(sectionEnrollments.sectionId, sectionId), eq(students.schoolId, classSections.schoolId)));
  if (!student) throw forbidden('Student is not enrolled in this section');
  if (!student.synthetic) throw forbidden('Only synthetic learners are permitted during development');
  let [link] = await db.select().from(learnerLinks).where(eq(learnerLinks.studentId, studentId));
  if (!link) {
    // Lock student too: the same learner can be captured concurrently in two sections.
    await db.select().from(students).where(eq(students.id, studentId)).for('update');
    [link] = await db.select().from(learnerLinks).where(eq(learnerLinks.studentId, studentId));
    if (!link) {
      const learnerKey = `lk_${newId()}`;
      await db.insert(learners).values({ learnerKey });
      [link] = await db.insert(learnerLinks).values({ studentId, learnerKey }).returning();
      const linkedCases = await db.select().from(caseLinks).where(eq(caseLinks.studentId, studentId));
      if (linkedCases.length) await db.update(cases).set({ learnerKey }).where(inArray(cases.caseKey, linkedCases.map((c) => c.caseKey)));
    }
  }
  await audit(db, { actorUserId: actor.userId, actorRole: role, action: 'plane.join', targetType: 'learner', targetId: link!.learnerKey, metadata: { purpose: 'classroom_membership' } });
  return link!.learnerKey;
}

export async function validateClassroomText(db: Db, sectionId: string, value: unknown) {
  const roster = await db.select({ first: students.firstName, last: students.lastName }).from(students).innerJoin(sectionEnrollments, eq(students.id, sectionEnrollments.studentId)).where(eq(sectionEnrollments.sectionId, sectionId));
  const denyNames = roster.flatMap((s) => [s.first, s.last, `${s.first} ${s.last}`]);
  const strings = (v: unknown): string[] => typeof v === 'string' ? [v] : v && typeof v === 'object' ? Object.values(v).flatMap(strings) : [];
  const spans = strings(value).flatMap((text) => detectPii(text, { denyNames }));
  if (hasHighConfidencePii(spans)) throw badRequest('Remove identifying details from classroom text. Select the student separately.', { spans });
}

export async function saveSeating(ctx: AppContext, actor: Actor, sectionId: string, input: SeatingInput) {
  const parsed = SeatingInput.parse(input);
  await requirePulse(ctx, actor, sectionId);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, sectionId)).for('update');
    const [latest] = await tx.select().from(seatingLayouts).where(eq(seatingLayouts.sectionId, sectionId)).orderBy(desc(seatingLayouts.version)).limit(1);
    if ((latest?.version ?? 0) !== parsed.expectedVersion) throw conflict('Seating changed. Reload before saving.');
    const positions = [];
    // Stable lock ordering avoids deadlocks between sections sharing students.
    for (const p of [...parsed.positions].sort((a, b) => a.studentId.localeCompare(b.studentId))) positions.push({ learnerKey: await learnerFor(tx, actor, sectionId, p.studentId), row: p.row, column: p.column });
    const [layout] = await tx.insert(seatingLayouts).values({ id: newId(), sectionId, version: parsed.expectedVersion + 1, positions, createdBy: actor.userId }).returning();
    await trail(tx, actor, 'classroom.seating', 'seating_layout', layout!.id, { version: layout!.version });
    return { version: layout!.version };
  });
}
export async function getSeating(ctx: AppContext, actor: Actor, sectionId: string) {
  await requirePulse(ctx, actor, sectionId);
  const [layout] = await ctx.db.select().from(seatingLayouts).where(eq(seatingLayouts.sectionId, sectionId)).orderBy(desc(seatingLayouts.version)).limit(1);
  const links = await ctx.db.select({ learnerKey: learnerLinks.learnerKey, studentId: learnerLinks.studentId }).from(learnerLinks).innerJoin(sectionEnrollments, eq(learnerLinks.studentId, sectionEnrollments.studentId)).where(eq(sectionEnrollments.sectionId, sectionId));
  await trail(ctx.db, actor, 'plane.join', 'section', sectionId, { purpose: 'seating_read' });
  return { version: layout?.version ?? 0, positions: (layout?.positions ?? []).flatMap((p) => { const link = links.find((l) => l.learnerKey === p.learnerKey); return link ? [{ studentId: link.studentId, row: p.row, column: p.column }] : []; }) };
}

export async function openSession(ctx: AppContext, actor: Actor, input: SessionInput) {
  const parsed = SessionInput.parse(input);
  const section = await requirePulse(ctx, actor, parsed.sectionId);
  await validateClassroomText(ctx.db, section.id, { topic: parsed.topic, objective: parsed.objective, tags: parsed.contextTags });
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, section.id)).for('update');
    const [retry] = await tx.select().from(classSessions).where(and(eq(classSessions.teacherId, actor.userId), eq(classSessions.requestId, parsed.requestId)));
    if (retry) { if (retry.inputHash !== hash(parsed)) throw conflict('Request ID was already used for different session content'); return { id: retry.id }; }
    const [layout] = await tx.select().from(seatingLayouts).where(eq(seatingLayouts.sectionId, section.id)).orderBy(desc(seatingLayouts.version)).limit(1);
    const members = await tx.select({ learnerKey: learnerLinks.learnerKey }).from(learnerLinks).innerJoin(sectionEnrollments, eq(learnerLinks.studentId, sectionEnrollments.studentId)).where(eq(sectionEnrollments.sectionId, section.id));
    const id = newId();
    await tx.insert(classSessions).values({ id, requestId: parsed.requestId, inputHash: hash(parsed), sectionId: section.id, schoolId: section.schoolId, teacherId: actor.userId, date: parsed.date, timezone: section.timezone, topic: parsed.topic, objective: parsed.objective, contextTags: parsed.contextTags, seatingVersion: layout?.version ?? 0, seatingSnapshot: (layout?.positions ?? []).filter((p) => members.some((m) => m.learnerKey === p.learnerKey)) });
    await trail(tx, actor, 'classroom.session', 'session', id);
    return { id };
  });
}
export async function sessionFor(ctx: AppContext, actor: Actor, id: string) {
  const [session] = await ctx.db.select().from(classSessions).where(eq(classSessions.id, id));
  if (!session) throw notFound('Session not found');
  if (!canReadClassroomRecord(actor.scope, actor.userId, { sectionId: session.sectionId, createdBy: session.teacherId })) throw forbidden('Session is outside your scope');
  await requirePulse(ctx, actor, session.sectionId);
  return session;
}
export async function listSessions(ctx: AppContext, actor: Actor, sectionId: string) {
  await requirePulse(ctx, actor, sectionId);
  await trail(ctx.db, actor, 'classroom.read', 'section', sectionId, { purpose: 'sessions' });
  return ctx.db.select({ id: classSessions.id, date: classSessions.date, topic: classSessions.topic, objective: classSessions.objective, timezone: classSessions.timezone, contextTags: classSessions.contextTags, createdAt: classSessions.createdAt }).from(classSessions).where(and(eq(classSessions.sectionId, sectionId), eq(classSessions.teacherId, actor.userId))).orderBy(desc(classSessions.createdAt)).limit(50);
}

export async function captureEvent(ctx: AppContext, actor: Actor, input: CaptureEvent) {
  const parsed = CaptureEvent.parse(input);
  const session = await sessionFor(ctx, actor, parsed.sessionId);
  if (new Date(parsed.observedAt).getTime() > ctx.now().getTime() + 60_000) throw badRequest('Observation cannot be in the future');
  await validateClassroomText(ctx.db, session.sectionId, parsed.observation);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, session.sectionId)).for('update');
    const learnerKey = await learnerFor(tx, actor, session.sectionId, parsed.studentId);
    await rejectExpiredRequest(tx, 'event', actor.userId, parsed.requestId);
    const [retry] = await tx.select().from(eventRevisions).where(and(eq(eventRevisions.createdBy, actor.userId), eq(eventRevisions.requestId, parsed.requestId)));
    if (retry) { if (retry.inputHash !== hash(parsed)) throw conflict('Request ID was already used for a different observation'); return { id: retry.eventId, revision: retry.revision }; }
    const id = newId();
    await tx.insert(classroomEvents).values({ id, sessionId: session.id, sectionId: session.sectionId, schoolId: session.schoolId, revision: 1, status: parsed.confirmed ? 'confirmed' : 'pending', createdBy: actor.userId });
    await tx.insert(eventRevisions).values({ id: newId(), eventId: id, revision: 1, learnerKey, requestId: parsed.requestId, inputHash: hash(parsed), observation: parsed.observation, source: parsed.source, observedAt: new Date(parsed.observedAt), createdBy: actor.userId, confirmedBy: parsed.confirmed ? actor.userId : null, confirmedAt: parsed.confirmed ? ctx.now() : null });
    if (parsed.confirmed) await invalidateSessionActivities(tx, session.id);
    await trail(tx, actor, 'classroom.capture', 'classroom_event', id, { revision: 1, confirmed: parsed.confirmed, kind: parsed.observation.kind });
    return { id, revision: 1 };
  });
}

export async function eventFor(ctx: AppContext, actor: Actor, id: string) {
  const [event] = await ctx.db.select().from(classroomEvents).where(eq(classroomEvents.id, id));
  if (!event) throw notFound('Observation not found');
  if (!canReadClassroomRecord(actor.scope, actor.userId, event)) throw forbidden('Observation is outside your scope');
  await requirePulse(ctx, actor, event.sectionId);
  return event;
}
export async function reviseEvent(ctx: AppContext, actor: Actor, id: string, input: ReviseEvent) {
  const parsed = ReviseEvent.parse(input);
  const event = await eventFor(ctx, actor, id);
  await validateClassroomText(ctx.db, event.sectionId, { observation: parsed.observation, reason: parsed.reason });
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, event.sectionId)).for('update');
    const learnerKey = await learnerFor(tx, actor, event.sectionId, parsed.studentId);
    await rejectExpiredRequest(tx, 'event', actor.userId, parsed.requestId);
    const [current] = await tx.select().from(classroomEvents).where(eq(classroomEvents.id, id)).for('update');
    const [retry] = await tx.select().from(eventRevisions).where(and(eq(eventRevisions.createdBy, actor.userId), eq(eventRevisions.requestId, parsed.requestId)));
    if (retry) { if (retry.eventId !== id || retry.inputHash !== hash(parsed)) throw conflict('Request ID was already used'); return { id, revision: retry.revision }; }
    if (current!.revision !== parsed.expectedRevision || current!.status === 'withdrawn') throw conflict('Observation changed. Reload the current version.');
    const [previous] = await tx.select().from(eventRevisions).where(and(eq(eventRevisions.eventId, id), eq(eventRevisions.revision, parsed.expectedRevision)));
    const revision = parsed.expectedRevision + 1;
    await tx.insert(eventRevisions).values({ id: newId(), eventId: id, revision, learnerKey, requestId: parsed.requestId, inputHash: hash(parsed), observation: parsed.observation, source: previous!.source, observedAt: previous!.observedAt, createdBy: actor.userId, confirmedBy: parsed.confirmed ? actor.userId : null, confirmedAt: parsed.confirmed ? ctx.now() : null, reason: parsed.reason });
    await tx.update(classroomEvents).set({ revision, status: parsed.confirmed ? 'confirmed' : 'pending' }).where(eq(classroomEvents.id, id));
    await invalidateEventArtifacts(tx, event.sectionId, id);
    await trail(tx, actor, 'classroom.correct', 'classroom_event', id, { revision, previousRevision: parsed.expectedRevision, confirmed: parsed.confirmed });
    return { id, revision };
  });
}
export async function confirmEvent(ctx: AppContext, actor: Actor, id: string, expectedRevision: number) {
  const event = await eventFor(ctx, actor, id);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, event.sectionId)).for('update');
    const [current] = await tx.select().from(classroomEvents).where(eq(classroomEvents.id, id)).for('update');
    if (current!.revision !== expectedRevision || current!.status === 'withdrawn') throw conflict('Observation changed. Review its current version.');
    const [revision] = await tx.select().from(eventRevisions).where(and(eq(eventRevisions.eventId, id), eq(eventRevisions.revision, expectedRevision)));
    const [link] = await tx.select().from(learnerLinks).where(eq(learnerLinks.learnerKey, revision!.learnerKey));
    if (!link) throw conflict('Learner is no longer available');
    await learnerFor(tx, actor, event.sectionId, link.studentId);
    if (current!.status === 'confirmed') return { id, revision: expectedRevision };
    if (revision!.createdAt < daysAgo(ctx.now(), (await retentionFor(tx, event.schoolId)).pendingDays)) throw conflict('Pending observation expired');
    await tx.update(eventRevisions).set({ confirmedBy: actor.userId, confirmedAt: ctx.now() }).where(eq(eventRevisions.id, revision!.id));
    await tx.update(classroomEvents).set({ status: 'confirmed' }).where(eq(classroomEvents.id, id));
    await invalidateSessionActivities(tx, event.sessionId);
    await trail(tx, actor, 'classroom.confirm', 'classroom_event', id, { revision: expectedRevision });
    return { id, revision: expectedRevision };
  });
}
export async function withdrawEvent(ctx: AppContext, actor: Actor, id: string, expectedRevision: number) {
  const event = await eventFor(ctx, actor, id);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, event.sectionId)).for('update');
    const [current] = await tx.select().from(classroomEvents).where(eq(classroomEvents.id, id)).for('update');
    if (current!.revision !== expectedRevision) throw conflict('Observation changed. Reload before undoing.');
    if (current!.status === 'withdrawn') return { ok: true };
    await tx.update(classroomEvents).set({ status: 'withdrawn' }).where(eq(classroomEvents.id, id));
    await invalidateEventArtifacts(tx, event.sectionId, id);
    await trail(tx, actor, 'classroom.withdraw', 'classroom_event', id, { revision: expectedRevision });
    return { ok: true };
  });
}
export async function sessionEvents(ctx: AppContext, actor: Actor, sessionId: string) {
  const session = await sessionFor(ctx, actor, sessionId);
  const rows = await ctx.db.select({ id: classroomEvents.id, revision: classroomEvents.revision, status: classroomEvents.status, observation: eventRevisions.observation, source: eventRevisions.source, observedAt: eventRevisions.observedAt, confirmedAt: eventRevisions.confirmedAt, confirmedBy: eventRevisions.confirmedBy, studentId: learnerLinks.studentId }).from(classroomEvents).innerJoin(eventRevisions, and(eq(classroomEvents.id, eventRevisions.eventId), eq(classroomEvents.revision, eventRevisions.revision))).innerJoin(learnerLinks, eq(eventRevisions.learnerKey, learnerLinks.learnerKey)).innerJoin(sectionEnrollments, and(eq(learnerLinks.studentId, sectionEnrollments.studentId), eq(sectionEnrollments.sectionId, classroomEvents.sectionId))).where(and(eq(classroomEvents.sessionId, sessionId), eq(classroomEvents.createdBy, actor.userId))).orderBy(desc(eventRevisions.observedAt));
  await trail(ctx.db, actor, 'plane.join', 'session', sessionId, { purpose: 'classroom_events', count: rows.length });
  const links = await ctx.db.select({ learnerKey: learnerLinks.learnerKey, studentId: learnerLinks.studentId }).from(learnerLinks).innerJoin(sectionEnrollments, eq(learnerLinks.studentId, sectionEnrollments.studentId)).where(eq(sectionEnrollments.sectionId, session.sectionId));
  const seating = session.seatingSnapshot.flatMap((p) => { const link = links.find((l) => l.learnerKey === p.learnerKey); return link ? [{ studentId: link.studentId, row: p.row, column: p.column }] : []; });
  return { session: { id: session.id, date: session.date, topic: session.topic, objective: session.objective, timezone: session.timezone, contextTags: session.contextTags, seatingVersion: session.seatingVersion }, seating, events: rows };
}
