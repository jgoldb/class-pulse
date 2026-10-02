import { and, desc, eq, inArray } from 'drizzle-orm';
import { nextClassDate, schoolClock, scheduleDue, TomorrowSchedule, type ArtifactKind, type ClassroomObservation } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { artifactRevisions, classSessions, classroomEvents, eventRevisions, jobs, learnerLinks, students, tomorrowSchedules, users } from '../db/schema';
import { requirePulse } from './pulse';
import { buildActor } from './scope';
import { listArtifacts, requestArtifact } from './artifacts';
import { listFollowUps } from './follow-ups';
import { audit } from './audit';

export async function getTomorrowSchedule(ctx: AppContext, actor: Actor, sectionId: string) {
  const section = await requirePulse(ctx, actor, sectionId);
  const [row] = await ctx.db.select().from(tomorrowSchedules).where(and(eq(tomorrowSchedules.sectionId, sectionId), eq(tomorrowSchedules.teacherId, actor.userId)));
  return { timezone: section.timezone, settings: row?.settings ?? { enabled: false, time: '15:30', classWeekdays: [1, 2, 3, 4, 5], closureDates: [] }, lastResult: row?.lastResult ?? null, targetDate: row?.targetDate ?? null };
}
export async function saveTomorrowSchedule(ctx: AppContext, actor: Actor, sectionId: string, input: TomorrowSchedule) {
  await requirePulse(ctx, actor, sectionId);
  const settings = TomorrowSchedule.parse(input);
  await ctx.db.transaction(async (tx) => {
    await tx.insert(tomorrowSchedules).values({ sectionId, teacherId: actor.userId, settings }).onConflictDoUpdate({ target: [tomorrowSchedules.sectionId, tomorrowSchedules.teacherId], set: { settings, updatedAt: ctx.now() } });
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'classroom.configure', targetType: 'tomorrow_schedule', targetId: sectionId, metadata: { enabled: settings.enabled } });
  });
  return { ok: true };
}

/** Date claim and durable job insertion are atomic, including across multiple API workers. */
export async function enqueueTomorrowSchedules(ctx: AppContext) {
  const all = await ctx.db.select().from(tomorrowSchedules);
  for (const schedule of all) {
    const [user] = await ctx.db.select().from(users).where(eq(users.id, schedule.teacherId));
    if (!user) continue;
    const actor = await buildActor(ctx.db, user);
    let timezone: string;
    try { const section = await requirePulse(ctx, actor, schedule.sectionId); if (section.archivedAt) continue; timezone = section.timezone; } catch { continue; }
    await ctx.db.transaction(async (tx) => {
      const [current] = await tx.select().from(tomorrowSchedules).where(and(eq(tomorrowSchedules.sectionId, schedule.sectionId), eq(tomorrowSchedules.teacherId, schedule.teacherId))).for('update');
      const due = scheduleDue(ctx.now(), timezone, current!.settings, current!.lastPreparedDate);
      if (!due) return;
      await tx.insert(jobs).values({ id: `prepare_tomorrow:${schedule.teacherId}:${schedule.sectionId}:${due.preparedDate}`, type: 'prepare_tomorrow', payload: { teacherId: schedule.teacherId, sectionId: schedule.sectionId, ...due } }).onConflictDoNothing();
      await tx.update(tomorrowSchedules).set({ lastPreparedDate: due.preparedDate, targetDate: due.targetDate, lastResult: 'queued', updatedAt: ctx.now() }).where(and(eq(tomorrowSchedules.sectionId, schedule.sectionId), eq(tomorrowSchedules.teacherId, schedule.teacherId)));
    });
  }
}

export async function prepareTomorrow(ctx: AppContext, teacherId: string, sectionId: string, preparedDate: string) {
  const [user] = await ctx.db.select().from(users).where(eq(users.id, teacherId));
  if (!user) return;
  const actor = await buildActor(ctx.db, user);
  let result = 'No confirmed observations for this class date';
  try {
    await requirePulse(ctx, actor, sectionId);
    const [schedule] = await ctx.db.select().from(tomorrowSchedules).where(and(eq(tomorrowSchedules.sectionId, sectionId), eq(tomorrowSchedules.teacherId, teacherId)));
    if (!schedule?.settings.enabled) return;
    const [session] = await ctx.db.select().from(classSessions).where(and(eq(classSessions.sectionId, sectionId), eq(classSessions.teacherId, teacherId), eq(classSessions.date, preparedDate))).orderBy(desc(classSessions.createdAt)).limit(1);
    if (session) {
      const prepared = await prepareSessionBundle(ctx, actor, session.id);
      if (prepared.length) result = ctx.aiConfig.provider === 'off' ? 'AI disabled; capture remains saved' : `Next-class materials requested (${prepared.map(humanKind).join(', ')}); educator review required`;
    }
  } catch { result = 'Preparation unavailable; check source access and prepare on demand'; }
  await ctx.db.update(tomorrowSchedules).set({ lastResult: result, updatedAt: ctx.now() }).where(and(eq(tomorrowSchedules.sectionId, sectionId), eq(tomorrowSchedules.teacherId, teacherId), eq(tomorrowSchedules.lastPreparedDate, preparedDate)));
}

const humanKind = (k: ArtifactKind) => ({ do_now: 'Do Now', reteach: 'reteach', small_group: 'small group' } as Record<string, string>)[k] ?? k;
const TOMORROW_KINDS: ArtifactKind[] = ['do_now', 'reteach', 'small_group'];
type Confirmed = { eventId: string; revision: number; learnerKey: string; observation: ClassroomObservation };

async function confirmedEvents(ctx: AppContext, sessionId: string): Promise<Confirmed[]> {
  return ctx.db.select({ eventId: classroomEvents.id, revision: classroomEvents.revision, learnerKey: eventRevisions.learnerKey, observation: eventRevisions.observation }).from(classroomEvents)
    .innerJoin(eventRevisions, and(eq(eventRevisions.eventId, classroomEvents.id), eq(eventRevisions.revision, classroomEvents.revision)))
    .where(and(eq(classroomEvents.sessionId, sessionId), eq(classroomEvents.status, 'confirmed'))).orderBy(classroomEvents.id).limit(100);
}
const needsPractice = (o: ClassroomObservation) => (o.kind === 'understanding' && o.evidence === 'needs_practice') || (o.kind === 'exit_ticket' && o.assessment === 'needs_practice');

/**
 * Tomorrow Ready: from one session's confirmed observations, request the next-class bundle: a Do
 * Now from everything, a reteach from needs-practice evidence, and a temporary practice group per
 * concept where 2-8 students need practice. Requests are idempotent (same sources give the same
 * draft), and each result is a draft awaiting the teacher's approval.
 */
export async function prepareSessionBundle(ctx: AppContext, actor: Actor, sessionId: string) {
  const events = await confirmedEvents(ctx, sessionId);
  if (!events.length) return [];
  const ref = (e: Confirmed) => ({ eventId: e.eventId, revision: e.revision });
  const requested: ArtifactKind[] = [];
  await requestArtifact(ctx, actor, { sessionId, kind: 'do_now', sources: events.map(ref) });
  requested.push('do_now');
  const practice = events.filter((e) => needsPractice(e.observation));
  if (practice.length) {
    await requestArtifact(ctx, actor, { sessionId, kind: 'reteach', sources: practice.map(ref) });
    requested.push('reteach');
  }
  const byConcept = new Map<string, Confirmed[]>();
  for (const e of practice) {
    const concept = 'concept' in e.observation ? e.observation.concept.trim().toLowerCase() : '';
    if (concept) byConcept.set(concept, [...(byConcept.get(concept) ?? []), e]);
  }
  for (const group of byConcept.values()) {
    const learners = new Set(group.map((e) => e.learnerKey));
    if (learners.size < 2 || learners.size > 8) continue;
    await requestArtifact(ctx, actor, { sessionId, kind: 'small_group', sources: group.map(ref) });
    if (!requested.includes('small_group')) requested.push('small_group');
  }
  return requested;
}

async function latestSession(ctx: AppContext, actor: Actor, sectionId: string) {
  const [session] = await ctx.db.select().from(classSessions).where(and(eq(classSessions.sectionId, sectionId), eq(classSessions.teacherId, actor.userId))).orderBy(desc(classSessions.date), desc(classSessions.createdAt)).limit(1);
  return session ?? null;
}

export async function prepareTomorrowNow(ctx: AppContext, actor: Actor, sectionId: string) {
  await requirePulse(ctx, actor, sectionId);
  const session = await latestSession(ctx, actor, sectionId);
  if (!session) return { requested: [] as ArtifactKind[], message: 'Open a class session and confirm observations first.' };
  const requested = await prepareSessionBundle(ctx, actor, session.id);
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'artifact.request', targetType: 'session', targetId: session.id, metadata: { purpose: 'tomorrow_bundle', kinds: requested } });
  return { requested, message: requested.length ? 'Preparing tomorrow’s materials for your review.' : 'No confirmed observations in the latest session yet.' };
}

/** Everything the teacher needs for the next class, in one place. */
export async function tomorrowBundle(ctx: AppContext, actor: Actor, sectionId: string) {
  const section = await requirePulse(ctx, actor, sectionId);
  const { settings, lastResult } = await getTomorrowSchedule(ctx, actor, sectionId);
  const today = schoolClock(ctx.now(), section.timezone).date;
  const session = await latestSession(ctx, actor, sectionId);
  const targetDate = nextClassDate(session && session.date > today ? session.date : today, settings);
  const drafts = (await listArtifacts(ctx, actor)).filter((d) => d.sectionId === sectionId && d.reviewState !== 'discarded');
  const sessionDrafts = session ? drafts.filter((d) => d.sessionId === session.id) : [];
  const instructional = sessionDrafts.filter((d) => TOMORROW_KINDS.includes(d.kind));
  const revisions = instructional.length ? await ctx.db.select().from(artifactRevisions).where(inArray(artifactRevisions.draftId, instructional.map((d) => d.id))) : [];
  const preview = (d: (typeof drafts)[number]) => (d.reviewState === 'stale' ? null : revisions.find((r) => r.draftId === d.id && r.revision === d.revision)?.content ?? null);
  const events = session ? await confirmedEvents(ctx, session.id) : [];
  const keys = [...new Set(events.map((e) => e.learnerKey))];
  const people = keys.length ? await ctx.db.select({ learnerKey: learnerLinks.learnerKey, id: students.id, first: students.firstName, last: students.lastName }).from(learnerLinks).innerJoin(students, eq(students.id, learnerLinks.studentId)).where(inArray(learnerLinks.learnerKey, keys)) : [];
  if (people.length) await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'plane.join', targetType: 'section', targetId: sectionId, metadata: { purpose: 'tomorrow_bundle', learners: people.length } });
  // Family drafts are one per student and opt-in: offer students with a confirmed success today.
  const familyCandidates = people.flatMap((p) => {
    const wins = events.filter((e) => e.learnerKey === p.learnerKey && ['praise', 'participation'].includes(e.observation.kind));
    if (!wins.length) return [];
    const existing = sessionDrafts.find((d) => d.kind === 'parent_message' && d.students.some((s) => s.id === p.id));
    return [{ studentId: p.id, displayName: `${p.first} ${p.last}`, sources: wins.map((e) => ({ eventId: e.eventId, revision: e.revision })), draftId: existing?.id ?? null }];
  });
  const followUps = await listFollowUps(ctx, actor);
  const due = followUps.filter((f) => f.sectionId === sectionId && ['open', 'needs_review'].includes(f.status) && (!targetDate || f.dueDate <= targetDate));
  return {
    section: { id: section.id, name: section.name, timezone: section.timezone },
    today, targetDate, schedule: { enabled: settings.enabled, time: settings.time, lastResult },
    session: session ? { id: session.id, date: session.date, topic: session.topic, objective: session.objective, confirmedCount: events.length, needsPractice: events.filter((e) => needsPractice(e.observation)).length } : null,
    instructional: instructional.map((d) => ({ ...d, preview: preview(d) })),
    family: { drafts: sessionDrafts.filter((d) => d.kind === 'parent_message'), candidates: familyCandidates },
    reminders: due.filter((f) => f.kind === 'follow_up'),
    interventionReviews: { tasks: due.filter((f) => f.kind === 'intervention_review'), packets: drafts.filter((d) => ['sst_report', 'mtss_report', 'fba_observations'].includes(d.kind) && d.reviewState === 'suggested') },
  };
}
