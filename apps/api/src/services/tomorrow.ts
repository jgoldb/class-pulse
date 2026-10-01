import { and, desc, eq } from 'drizzle-orm';
import { scheduleDue, TomorrowSchedule } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { classSessions, classroomEvents, jobs, tomorrowSchedules, users } from '../db/schema';
import { requirePulse } from './pulse';
import { buildActor } from './scope';
import { requestArtifact } from './artifacts';
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
    try { timezone = (await requirePulse(ctx, actor, schedule.sectionId)).timezone; } catch { continue; }
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
      const sources = await ctx.db.select({ eventId: classroomEvents.id, revision: classroomEvents.revision }).from(classroomEvents).where(and(eq(classroomEvents.sessionId, session.id), eq(classroomEvents.status, 'confirmed'))).orderBy(classroomEvents.id).limit(100);
      if (sources.length) {
        await requestArtifact(ctx, actor, { sessionId: session.id, kind: 'do_now', sources });
        result = ctx.aiConfig.provider === 'off' ? 'AI disabled; capture remains saved' : 'Next-class activity requested; educator review required';
      }
    }
  } catch { result = 'Preparation unavailable; check source access and prepare on demand'; }
  await ctx.db.update(tomorrowSchedules).set({ lastResult: result, updatedAt: ctx.now() }).where(and(eq(tomorrowSchedules.sectionId, sectionId), eq(tomorrowSchedules.teacherId, teacherId), eq(tomorrowSchedules.lastPreparedDate, preparedDate)));
}
