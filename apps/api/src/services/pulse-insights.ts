import { and, desc, eq, gte, inArray } from 'drizzle-orm';
import { schoolClock } from '@class-pulse/domain';
import { suppressCells } from '@class-pulse/policy';
import type { Actor, AppContext } from '../context';
import { forbidden } from '../context';
import { classSections, classroomDrafts, classroomEvents, eventRevisions, followUpTasks, learnerLinks, organizations, roleAssignments, schools, sectionEnrollments, students } from '../db/schema';
import { audit } from './audit';

/** Fixed categorical cohorts, unique learners and no free-text dimensions or drill-down. */
export async function pulseInsights(ctx: AppContext, actor: Actor) {
  if (!actor.roles.has('administrator')) throw forbidden('Administrator role required');
  const schoolIds = [...actor.scope.adminSchoolIds], min = ctx.config.adminMinCellSize;
  const empty = { windowDays: 30, minCellSize: min, participation: suppressCells([], min), instruction: suppressCells([], min), followUps: suppressCells([], min), documentation: suppressCells([], min) };
  if (!schoolIds.length || ctx.config.deploymentPosture !== 'demonstration') return empty;
  const population = await ctx.db.select({ studentId: students.id, learnerKey: learnerLinks.learnerKey, sectionId: classSections.id, timezone: schools.timezone }).from(students)
    .innerJoin(sectionEnrollments, eq(sectionEnrollments.studentId, students.id)).innerJoin(classSections, and(eq(classSections.id, sectionEnrollments.sectionId), eq(classSections.schoolId, students.schoolId)))
    .innerJoin(schools, eq(schools.id, students.schoolId)).innerJoin(organizations, eq(organizations.id, schools.orgId)).leftJoin(learnerLinks, eq(learnerLinks.studentId, students.id))
    .where(and(inArray(students.schoolId, schoolIds), eq(students.synthetic, true), eq(organizations.pulseraEnabled, true)));
  const roster = [...new Set(population.map((p) => p.studentId))], sections = [...new Set(population.map((p) => p.sectionId))];
  if (!sections.length) return empty;
  const assignments = await ctx.db.select({ userId: roleAssignments.userId, sectionId: roleAssignments.sectionId }).from(roleAssignments).where(and(inArray(roleAssignments.sectionId, sections), eq(roleAssignments.role, 'teacher')));
  const currentTeacher = (id: string, sectionId: string) => assignments.some((a) => a.userId === id && a.sectionId === sectionId);
  const rows = await ctx.db.select({ event: classroomEvents, revision: eventRevisions }).from(classroomEvents).innerJoin(eventRevisions, and(eq(eventRevisions.eventId, classroomEvents.id), eq(eventRevisions.revision, classroomEvents.revision)))
    .where(and(inArray(classroomEvents.sectionId, sections), eq(classroomEvents.status, 'confirmed'), gte(eventRevisions.observedAt, new Date(ctx.now().getTime() - 120 * 86400000)))).orderBy(desc(eventRevisions.observedAt));
  const eligible = rows.flatMap((r) => {
    const person = population.find((p) => p.learnerKey === r.revision.learnerKey && p.sectionId === r.event.sectionId);
    return person && r.revision.confirmedAt && currentTeacher(r.event.createdBy, r.event.sectionId) ? [{ ...r, studentId: person.studentId }] : [];
  });
  const recent = eligible.filter((r) => r.revision.observedAt.getTime() >= ctx.now().getTime() - 30 * 86400000);
  const drafts = await ctx.db.select().from(classroomDrafts).where(and(inArray(classroomDrafts.sectionId, sections), gte(classroomDrafts.createdAt, new Date(ctx.now().getTime() - 30 * 86400000)))).orderBy(desc(classroomDrafts.updatedAt));
  const validDrafts = drafts.flatMap((d) => {
    if (!currentTeacher(d.createdBy, d.sectionId) || ['discarded', 'stale'].includes(d.reviewState) || (d.publicationState !== 'logged' && d.expiresAt <= ctx.now()) || !d.sources.length) return [];
    const evidence = d.sources.map((s) => eligible.find((r) => r.event.id === s.eventId && r.event.revision === s.revision && r.event.createdBy === d.createdBy));
    return evidence.every(Boolean) ? [{ ...d, studentIds: [...new Set(evidence.map((e) => e!.studentId))] }] : [];
  });
  const tasks = await ctx.db.select().from(followUpTasks).where(and(inArray(followUpTasks.sectionId, sections), gte(followUpTasks.createdAt, new Date(ctx.now().getTime() - 30 * 86400000))));
  const group = (keys: string[], classify: (studentId: string) => string) => {
    const counts = new Map(keys.map((key) => [key, 0]));
    for (const student of roster) { const key = classify(student); counts.set(key, (counts.get(key) ?? 0) + 1); }
    const result = suppressCells([...counts].map(([key, count]) => ({ key, count })), min);
    if (roster.length > 0 && roster.length < min) result.total = null;
    return result;
  };
  const result = {
    windowDays: 30, minCellSize: min,
    participation: group(['Recorded participation', 'No participation observation'], (id) => recent.some((r) => r.studentId === id && r.revision.observation.kind === 'participation') ? 'Recorded participation' : 'No participation observation'),
    instruction: group(['Latest check: demonstrated', 'Latest check: needs practice', 'Latest check: not assessed', 'No instructional check'], (id) => {
      const o = recent.find((r) => r.studentId === id && ['understanding', 'exit_ticket'].includes(r.revision.observation.kind))?.revision.observation;
      const value = o?.kind === 'understanding' ? o.evidence : o?.kind === 'exit_ticket' ? o.assessment : null;
      return !value ? 'No instructional check' : value === 'demonstrated' ? 'Latest check: demonstrated' : value === 'needs_practice' ? 'Latest check: needs practice' : 'Latest check: not assessed';
    }),
    followUps: group(['Due follow-up', 'Open follow-up', 'Completed follow-up', 'No current follow-up'], (id) => {
      const mine = tasks.filter((t) => validDrafts.some((d) => d.id === t.draftId && d.revision === t.artifactRevision && d.reviewState === 'approved' && d.publicationState === 'logged' && d.studentIds.includes(id)));
      if (mine.some((t) => t.status === 'open' && t.dueDate <= schoolClock(ctx.now(), population.find((p) => p.sectionId === t.sectionId)!.timezone).date)) return 'Due follow-up';
      if (mine.some((t) => t.status === 'open')) return 'Open follow-up';
      return mine.some((t) => t.status === 'completed') ? 'Completed follow-up' : 'No current follow-up';
    }),
    documentation: group(['Approved evidence packet', 'Evidence packet awaiting review', 'No current evidence packet'], (id) => {
      const packet = validDrafts.find((d) => ['abc', 'sst_report', 'mtss_report', 'fba_observations'].includes(d.kind) && d.studentIds.includes(id));
      return !packet ? 'No current evidence packet' : packet.reviewState === 'approved' && packet.publicationState === 'logged' ? 'Approved evidence packet' : 'Evidence packet awaiting review';
    }),
  };
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'administrator', action: 'classroom.insights', targetType: 'aggregate', metadata: { schoolIds, windowDays: 30, minCellSize: min } });
  return result;
}
