import { and, eq, inArray } from 'drizzle-orm';
import { SEED_CONTEXT_TAGS, newId } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { badRequest, conflict } from '../context';
import { caseLinks, cases, classSections, classSessions, classroomEvents, eventRevisions, goals, learnerLinks, plans, sectionEnrollments, signalProjections, signals, strategies } from '../db/schema';
import { eventFor } from './pulse';
import { requireTeacherLike } from './cases';
import { orgContextTags } from './roster';
import { audit } from './audit';

export async function projectEvent(ctx: AppContext, actor: Actor, eventId: string, input: { expectedRevision: number; caseKey: string; goalId: string | null; strategyId: string | null }) {
  const event = await eventFor(ctx, actor, eventId);
  requireTeacherLike(actor, input.caseKey);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, event.sectionId)).for('update');
    const [current] = await tx.select().from(classroomEvents).where(eq(classroomEvents.id, eventId)).for('update');
    if (current!.revision !== input.expectedRevision || current!.status !== 'confirmed') throw conflict('Confirm the current observation version first');
    const [revision] = await tx.select().from(eventRevisions).where(and(eq(eventRevisions.eventId, eventId), eq(eventRevisions.revision, input.expectedRevision)));
    const [learner] = await tx.select().from(learnerLinks).where(eq(learnerLinks.learnerKey, revision!.learnerKey));
    const [enrollment] = learner ? await tx.select().from(sectionEnrollments).where(and(eq(sectionEnrollments.studentId, learner.studentId), eq(sectionEnrollments.sectionId, event.sectionId))) : [];
    if (!enrollment || !revision!.confirmedAt || revision!.observedAt.getTime() < ctx.now().getTime() - 120 * 86400000) throw conflict('Source evidence is no longer eligible');
    const [destination] = await tx.select({ record: cases, studentId: caseLinks.studentId }).from(cases).innerJoin(caseLinks, eq(caseLinks.caseKey, cases.caseKey)).where(eq(cases.caseKey, input.caseKey));
    if (!learner || !destination || destination.studentId !== learner.studentId || destination.record.sectionId !== event.sectionId || destination.record.schoolId !== event.schoolId) throw badRequest('Destination must be this learner’s case in this section and school');
    // Projection never widens an observation into an unrelated goal or strategy.
    if (input.goalId) {
      const [goal] = await tx.select().from(goals).innerJoin(plans, eq(goals.planId, plans.id)).where(and(eq(goals.id, input.goalId), eq(goals.caseKey, input.caseKey), eq(goals.status, 'active'), eq(plans.status, 'active')));
      if (!goal) throw badRequest('Goal is not active on the destination case');
    }
    if (input.strategyId) {
      const [strategy] = await tx.select().from(strategies).innerJoin(plans, eq(strategies.planId, plans.id)).where(and(eq(strategies.id, input.strategyId), eq(strategies.caseKey, input.caseKey), eq(strategies.status, 'active'), eq(plans.status, 'active')));
      if (!strategy) throw badRequest('Strategy is not active on the destination case');
    }
    const o = revision!.observation;
    if (o.kind !== 'attendance' && !(o.kind === 'behavior' && o.measuredCount !== null)) throw badRequest('Only explicit attendance or a measured behavior count can become a support signal');
    const [existing] = await tx.select().from(signalProjections).where(and(eq(signalProjections.eventId, eventId), eq(signalProjections.revision, input.expectedRevision), eq(signalProjections.caseKey, input.caseKey)));
    if (existing) {
      const [signal] = await tx.select().from(signals).where(eq(signals.id, existing.signalId));
      if (signal!.goalId !== input.goalId || signal!.strategyId !== input.strategyId) throw conflict('This revision was already projected with different goal or strategy links');
      return { signalId: existing.signalId };
    }
    const prior = await tx.select().from(signalProjections).where(and(eq(signalProjections.eventId, eventId), eq(signalProjections.caseKey, input.caseKey)));
    if (prior.length) await tx.update(signals).set({ retiredAt: ctx.now() }).where(inArray(signals.id, prior.map((p) => p.signalId)));
    const [session] = await tx.select().from(classSessions).where(eq(classSessions.id, event.sessionId));
    const allowedTags = new Set([...SEED_CONTEXT_TAGS, ...(await orgContextTags(tx, event.schoolId)).map((t) => t.tag)]);
    const signalId = newId();
    await tx.insert(signals).values({ id: signalId, caseKey: input.caseKey, type: o.kind === 'attendance' ? 'attendance' : 'behavior_event', valueNum: o.kind === 'attendance' ? ({ present: 1, absent: 0, late: 0.5 })[o.status] : o.measuredCount, unit: o.kind === 'attendance' ? 'presence' : 'events', contextTags: session!.contextTags.filter((t) => allowedTags.has(t)), observedAt: revision!.observedAt, source: 'teacher_entry', sourceConfidence: 'high', enteredBy: revision!.createdBy, goalId: input.goalId, strategyId: input.strategyId, note: o.note.slice(0, 500) || null });
    await tx.insert(signalProjections).values({ eventId, revision: input.expectedRevision, caseKey: input.caseKey, signalId, createdBy: actor.userId });
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'classroom.project', targetType: 'signal', targetId: signalId, caseKey: input.caseKey, metadata: { eventId, revision: input.expectedRevision } });
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'plane.join', targetType: 'learner', targetId: revision!.learnerKey, caseKey: input.caseKey, metadata: { purpose: 'explicit_case_projection' } });
    return { signalId };
  });
}
