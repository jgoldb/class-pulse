import { and, eq, inArray } from 'drizzle-orm';
import type { Actor, AppContext } from '../context';
import { badRequest, forbidden, notFound } from '../context';
import type { Db } from '../db/client';
import {
  artifactPublications, artifactRevisions, artifactShares, caseLinks, classSessions, classroomDrafts, classroomEgressPayloads, classroomEvents, classroomHelpRequests,
  contributionResponses, contributionRevisions, contributions, eventRevisions, followUpTasks, learnerLinks, schools, seatingLayouts, signalProjections, students,
} from '../db/schema';
import { audit } from './audit';
import { invalidateEventArtifacts } from './pulse-lineage';

/** Per-school retention policy (guide §P). Defaults match the synthetic-development proposal in docs/09. */
export async function retentionFor(db: Db, schoolId: string) {
  const [row] = await db.select({ pendingDays: schools.pendingRetentionDays, memoryDays: schools.memoryWindowDays }).from(schools).where(eq(schools.id, schoolId));
  return { pendingDays: row?.pendingDays ?? 30, memoryDays: row?.memoryDays ?? 120 };
}
export const daysAgo = (now: Date, days: number) => new Date(now.getTime() - days * 86400000);
export const daysAhead = (now: Date, days: number) => new Date(now.getTime() + days * 86400000);

async function adminStudent(ctx: AppContext, actor: Actor, studentId: string) {
  const [student] = await ctx.db.select().from(students).where(eq(students.id, studentId));
  if (!student) throw notFound('Learner not found');
  if (!actor.scope.adminSchoolIds.has(student.schoolId)) throw forbidden('Learner is outside the schools you administer');
  const [link] = await ctx.db.select().from(learnerLinks).where(eq(learnerLinks.studentId, studentId));
  return { student, learnerKey: link?.learnerKey ?? null };
}

export async function listLearners(ctx: AppContext, actor: Actor) {
  const ids = [...actor.scope.adminSchoolIds];
  if (!ids.length) return [];
  const rows = await ctx.db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName, gradeLevel: students.gradeLevel, schoolId: students.schoolId, synthetic: students.synthetic }).from(students).where(inArray(students.schoolId, ids));
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'administrator', action: 'classroom.read', targetType: 'learner_list', metadata: { count: rows.length, purpose: 'records_tool' } });
  return rows.map((r) => ({ id: r.id, displayName: `${r.firstName} ${r.lastName}`, gradeLevel: r.gradeLevel, schoolId: r.schoolId, synthetic: r.synthetic }));
}

/**
 * Portability: one learner's classroom record as JSON — confirmed observations, attributed
 * contributions with educator responses, and approved artifacts that concern only this learner.
 * Pending drafts and other learners' data are never included.
 */
export async function exportLearner(ctx: AppContext, actor: Actor, studentId: string) {
  const { student, learnerKey } = await adminStudent(ctx, actor, studentId);
  const observations = learnerKey ? await ctx.db.select({ id: classroomEvents.id, revision: classroomEvents.revision, sectionId: classroomEvents.sectionId, sessionDate: classSessions.date, topic: classSessions.topic, observation: eventRevisions.observation, source: eventRevisions.source, observedAt: eventRevisions.observedAt, confirmedAt: eventRevisions.confirmedAt })
    .from(classroomEvents).innerJoin(eventRevisions, and(eq(eventRevisions.eventId, classroomEvents.id), eq(eventRevisions.revision, classroomEvents.revision))).innerJoin(classSessions, eq(classSessions.id, classroomEvents.sessionId))
    .where(and(eq(eventRevisions.learnerKey, learnerKey), eq(classroomEvents.status, 'confirmed'))) : [];
  const contributed = learnerKey ? await ctx.db.select({ id: contributions.id, sourceRole: contributions.sourceRole, status: contributions.status, visibility: contributions.visibility, response: contributions.response, createdAt: contributions.createdAt, content: contributionRevisions.content })
    .from(contributions).innerJoin(contributionRevisions, and(eq(contributionRevisions.contributionId, contributions.id), eq(contributionRevisions.revision, contributions.revision)))
    .where(eq(contributions.learnerKey, learnerKey)) : [];
  const eventIds = new Set(observations.map((o) => o.id));
  const drafts = eventIds.size ? (await ctx.db.select().from(classroomDrafts).where(inArray(classroomDrafts.sectionId, [...new Set(observations.map((o) => o.sectionId))]))).filter((d) => d.reviewState === 'approved' && d.sources.length && d.sources.every((s) => eventIds.has(s.eventId))) : [];
  const approved = [];
  for (const d of drafts) {
    const [publication] = await ctx.db.select().from(artifactPublications).where(and(eq(artifactPublications.draftId, d.id), eq(artifactPublications.revision, d.revision)));
    const [revision] = await ctx.db.select().from(artifactRevisions).where(and(eq(artifactRevisions.draftId, d.id), eq(artifactRevisions.revision, d.revision)));
    if (publication && revision) approved.push({ kind: d.kind, revision: d.revision, approvedAt: publication.approvedAt, audience: publication.audience, content: revision.content });
  }
  const caseKeys = (await ctx.db.select({ caseKey: caseLinks.caseKey }).from(caseLinks).where(eq(caseLinks.studentId, studentId))).map((c) => c.caseKey);
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'administrator', action: 'learner.export', targetType: 'learner', studentId, metadata: { observations: observations.length, contributions: contributed.length, artifacts: approved.length } });
  return {
    format: 'pulsera.learner-record.v1', exportedAt: ctx.now(), exportedBy: actor.displayName,
    learner: { id: student.id, firstName: student.firstName, lastName: student.lastName, gradeLevel: student.gradeLevel, synthetic: student.synthetic },
    observations, contributions: contributed, approvedArtifacts: approved,
    supportRecords: { caseKeys, note: 'Support-plan records are exported from each case and are governed by their own retention.' },
  };
}

/**
 * Erasure on request: removes this learner's classroom observations, contributions, help requests,
 * seat positions and any drafts derived from their observations (including shared group drafts,
 * which contain their evidence). Projected case signals are retired, not deleted; support-plan
 * records follow their own process. The audit trail keeps counts only, never content.
 */
export async function eraseLearnerClassroomData(ctx: AppContext, actor: Actor, studentId: string, confirm: string) {
  const { student, learnerKey } = await adminStudent(ctx, actor, studentId);
  if (confirm.trim() !== `${student.firstName} ${student.lastName}`) throw badRequest('Type the learner’s full name exactly to confirm');
  if (!learnerKey) return { observations: 0, drafts: 0, contributions: 0, helpRequests: 0 };
  return ctx.db.transaction(async (tx) => {
    const revisions = await tx.select({ id: eventRevisions.id, eventId: eventRevisions.eventId }).from(eventRevisions).where(eq(eventRevisions.learnerKey, learnerKey));
    const eventIds = [...new Set(revisions.map((r) => r.eventId))];
    const events = eventIds.length ? await tx.select().from(classroomEvents).where(inArray(classroomEvents.id, eventIds)) : [];
    for (const e of events) await invalidateEventArtifacts(tx, e.sectionId, e.id);
    const sectionIds = [...new Set(events.map((e) => e.sectionId))];
    const drafts = sectionIds.length ? (await tx.select().from(classroomDrafts).where(inArray(classroomDrafts.sectionId, sectionIds))).filter((d) => d.sources.some((s) => eventIds.includes(s.eventId))) : [];
    if (drafts.length) {
      const ids = drafts.map((d) => d.id);
      const pubs = await tx.select({ id: artifactPublications.id }).from(artifactPublications).where(inArray(artifactPublications.draftId, ids));
      if (pubs.length) await tx.delete(artifactShares).where(inArray(artifactShares.publicationId, pubs.map((p) => p.id)));
      await tx.delete(followUpTasks).where(inArray(followUpTasks.draftId, ids));
      await tx.delete(artifactPublications).where(inArray(artifactPublications.draftId, ids));
      await tx.delete(artifactRevisions).where(inArray(artifactRevisions.draftId, ids));
      const runIds = drafts.flatMap((d) => d.runIds);
      if (runIds.length) await tx.delete(classroomEgressPayloads).where(inArray(classroomEgressPayloads.runId, runIds));
      await tx.delete(classroomDrafts).where(inArray(classroomDrafts.id, ids));
    }
    if (eventIds.length) {
      await tx.delete(signalProjections).where(inArray(signalProjections.eventId, eventIds));
      await tx.delete(eventRevisions).where(eq(eventRevisions.learnerKey, learnerKey));
      for (const e of events) {
        const left = await tx.select({ revision: eventRevisions.revision }).from(eventRevisions).where(eq(eventRevisions.eventId, e.id));
        if (!left.length) await tx.delete(classroomEvents).where(eq(classroomEvents.id, e.id));
        else if (!left.some((r) => r.revision === e.revision)) await tx.update(classroomEvents).set({ status: 'withdrawn' }).where(eq(classroomEvents.id, e.id));
      }
    }
    const mine = await tx.select({ id: contributions.id }).from(contributions).where(eq(contributions.learnerKey, learnerKey));
    if (mine.length) {
      const ids = mine.map((c) => c.id);
      await tx.delete(contributionResponses).where(inArray(contributionResponses.contributionId, ids));
      await tx.delete(contributionRevisions).where(inArray(contributionRevisions.contributionId, ids));
      await tx.delete(contributions).where(inArray(contributions.id, ids));
    }
    const help = await tx.delete(classroomHelpRequests).where(eq(classroomHelpRequests.learnerKey, learnerKey)).returning({ id: classroomHelpRequests.id });
    for (const layout of await tx.select().from(seatingLayouts)) {
      if (layout.positions.some((p) => p.learnerKey === learnerKey)) await tx.update(seatingLayouts).set({ positions: layout.positions.filter((p) => p.learnerKey !== learnerKey) }).where(eq(seatingLayouts.id, layout.id));
    }
    for (const session of await tx.select({ id: classSessions.id, seatingSnapshot: classSessions.seatingSnapshot }).from(classSessions)) {
      if (session.seatingSnapshot.some((p) => p.learnerKey === learnerKey)) await tx.update(classSessions).set({ seatingSnapshot: session.seatingSnapshot.filter((p) => p.learnerKey !== learnerKey) }).where(eq(classSessions.id, session.id));
    }
    const counts = { observations: revisions.length, drafts: drafts.length, contributions: mine.length, helpRequests: help.length };
    await audit(tx, { actorUserId: actor.userId, actorRole: 'administrator', action: 'learner.erase', targetType: 'learner', studentId, metadata: counts });
    return counts;
  });
}
