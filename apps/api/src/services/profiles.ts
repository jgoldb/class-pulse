import { and, desc, eq, gte, inArray, isNull } from 'drizzle-orm';
import { type ContributionContent } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { conflict, forbidden } from '../context';
import { artifactPublications, artifactShares, caseLinks, cases, classSections, classroomDrafts, classroomEvents, contributionRevisions, contributions, eventRevisions, learnerLinks, organizations, plans, roleAssignments, schools, sectionEnrollments, strategies, students, users } from '../db/schema';
import { audit } from './audit';
import { readArtifact } from './artifacts';
import { requirePulse } from './pulse';
import { buildActor } from './scope';

export type ProfileRole = 'teacher' | 'student' | 'guardian';
export async function profileScope(ctx: AppContext, actor: Actor, studentId: string, sectionId: string, role: ProfileRole) {
  if (role === 'teacher') await requirePulse(ctx, actor, sectionId);
  else if (!actor.assignments.some((a) => a.role === role && a.studentId === studentId)) throw forbidden('This learner is outside your relationship');
  const [row] = await ctx.db.select({ student: students, section: classSections, enabled: organizations.pulseraEnabled }).from(students)
    .innerJoin(sectionEnrollments, eq(sectionEnrollments.studentId, students.id)).innerJoin(classSections, and(eq(classSections.id, sectionEnrollments.sectionId), eq(classSections.schoolId, students.schoolId)))
    .innerJoin(schools, eq(schools.id, students.schoolId)).innerJoin(organizations, eq(organizations.id, schools.orgId))
    .where(and(eq(students.id, studentId), eq(classSections.id, sectionId), eq(students.synthetic, true)));
  if (!row) throw forbidden('Learner is not currently enrolled in this section');
  if (!row.enabled || ctx.config.deploymentPosture !== 'demonstration') throw conflict('Pulsera profiles are not enabled for this synthetic workspace');
  return row;
}

export async function listProfilePeople(ctx: AppContext, actor: Actor, role: ProfileRole) {
  const ids = role === 'teacher' ? [...actor.scope.identifiedStudentIds] : actor.assignments.filter((a) => a.role === role && a.studentId).map((a) => a.studentId!);
  if (!ids.length || ctx.config.deploymentPosture !== 'demonstration') return [];
  const rows = await ctx.db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName, sectionId: classSections.id, sectionName: classSections.name }).from(students)
    .innerJoin(sectionEnrollments, eq(sectionEnrollments.studentId, students.id)).innerJoin(classSections, and(eq(classSections.id, sectionEnrollments.sectionId), eq(classSections.schoolId, students.schoolId)))
    .innerJoin(schools, eq(schools.id, students.schoolId)).innerJoin(organizations, eq(organizations.id, schools.orgId))
    .where(and(inArray(students.id, ids), eq(students.synthetic, true), eq(organizations.pulseraEnabled, true)));
  const result: Array<{ id: string; displayName: string; sections: Array<{ id: string; name: string; teachers: Array<{ id: string; name: string }> }> }> = [];
  for (const row of rows) {
    if (role === 'teacher' && !actor.scope.teacherSectionIds.has(row.sectionId)) continue;
    let person = result.find((s) => s.id === row.id);
    if (!person) { person = { id: row.id, displayName: `${row.firstName} ${row.lastName}`, sections: [] }; result.push(person); }
    const teachers = await ctx.db.select({ id: users.id, name: users.displayName }).from(roleAssignments).innerJoin(users, eq(users.id, roleAssignments.userId)).where(and(eq(roleAssignments.sectionId, row.sectionId), eq(roleAssignments.role, 'teacher')));
    person.sections.push({ id: row.sectionId, name: row.sectionName, teachers: [...new Map(teachers.map((t) => [t.id, t])).values()] });
  }
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'profile.read', targetType: 'learner_list', metadata: { count: result.length } });
  return result;
}

export async function learnerProfile(ctx: AppContext, actor: Actor, studentId: string, sectionId: string, role: ProfileRole) {
  const { student } = await profileScope(ctx, actor, studentId, sectionId, role);
  const [link] = await ctx.db.select().from(learnerLinks).where(eq(learnerLinks.studentId, studentId));
  const cutoff = new Date(ctx.now().getTime() - 120 * 86400000);
  const links = await ctx.db.select({ caseKey: cases.caseKey }).from(caseLinks).innerJoin(cases, eq(cases.caseKey, caseLinks.caseKey)).where(and(eq(caseLinks.studentId, studentId), eq(cases.sectionId, sectionId), eq(cases.schoolId, student.schoolId)));
  const caseKeys = links.filter((l) => actor.scope.caseRoles.has(l.caseKey)).map((l) => l.caseKey);
  const approvedStrategies = caseKeys.length ? await ctx.db.select({ id: strategies.id, kind: strategies.kind, content: strategies.content }).from(strategies).innerJoin(plans, eq(plans.id, strategies.planId)).where(and(inArray(strategies.caseKey, caseKeys), eq(plans.status, 'active'), eq(strategies.status, 'active'), inArray(strategies.kind, role === 'student' ? ['replacement', 'self_monitor'] : role === 'guardian' ? ['family', 'replacement', 'self_monitor'] : ['family', 'replacement', 'self_monitor', 'preventive', 'response']))) : [];
  const shared: Array<{ id: string; kind: string; title: string; message: string; approvedAt: Date; sharedAt: Date; educator: string }> = [];
  if (role !== 'teacher' && link) {
    const publications = await ctx.db.select({ publication: artifactPublications, share: artifactShares, draft: classroomDrafts }).from(artifactShares)
      .innerJoin(artifactPublications, eq(artifactPublications.id, artifactShares.publicationId)).innerJoin(classroomDrafts, and(eq(classroomDrafts.id, artifactPublications.draftId), eq(classroomDrafts.revision, artifactPublications.revision)))
      .where(and(eq(classroomDrafts.sectionId, sectionId), eq(classroomDrafts.reviewState, 'approved'), eq(classroomDrafts.publicationState, 'logged'), eq(artifactPublications.audience, role === 'guardian' ? 'family' : 'student'), isNull(artifactShares.revokedAt))).orderBy(desc(artifactShares.sharedAt));
    for (const { publication, share, draft } of publications) {
      const revisions = draft.sources.length ? await ctx.db.select({ learnerKey: eventRevisions.learnerKey, eventId: eventRevisions.eventId, revision: eventRevisions.revision }).from(eventRevisions).where(inArray(eventRevisions.eventId, draft.sources.map((s) => s.eventId))) : [];
      const subjectRows = revisions.filter((r) => draft.sources.some((s) => s.eventId === r.eventId && s.revision === r.revision));
      if (subjectRows.length !== draft.sources.length || !subjectRows.length || subjectRows.some((r) => r.learnerKey !== link.learnerKey)) continue;
      const [owner] = await ctx.db.select().from(users).where(eq(users.id, draft.createdBy));
      if (!owner) continue;
      try {
        const detail = await readArtifact(ctx, await buildActor(ctx.db, owner), draft.id, false);
        const content = detail.revisions.find((r) => r.revision === publication.revision)?.content;
        if (content && (content.kind === 'positive_note' || content.kind === 'parent_message')) shared.push({ id: publication.id, kind: content.kind, title: content.title, message: content.message, approvedAt: publication.approvedAt, sharedAt: share.sharedAt, educator: owner.displayName });
      } catch { /* No publication survives revoked educator access, source correction or expiration. */ }
    }
  }
  const history = role === 'teacher' && link ? await ctx.db.select({ id: classroomEvents.id, revision: classroomEvents.revision, observation: eventRevisions.observation, observedAt: eventRevisions.observedAt, source: eventRevisions.source }).from(classroomEvents)
    .innerJoin(eventRevisions, and(eq(eventRevisions.eventId, classroomEvents.id), eq(eventRevisions.revision, classroomEvents.revision)))
    .where(and(eq(classroomEvents.sectionId, sectionId), eq(classroomEvents.createdBy, actor.userId), eq(classroomEvents.status, 'confirmed'), eq(eventRevisions.learnerKey, link.learnerKey), gte(eventRevisions.observedAt, cutoff))).orderBy(desc(eventRevisions.observedAt)).limit(100) : [];
  const accepted: Array<{ id: string; revision: number; sourceRole: string; content: ContributionContent; acceptedAt: Date | null }> = [];
  if (role === 'teacher' && link) {
    const rows = await ctx.db.select({ item: contributions, content: contributionRevisions.content }).from(contributions).innerJoin(contributionRevisions, and(eq(contributionRevisions.contributionId, contributions.id), eq(contributionRevisions.revision, contributions.revision))).where(and(eq(contributions.learnerKey, link.learnerKey), eq(contributions.sectionId, sectionId), eq(contributions.recipientId, actor.userId), eq(contributions.status, 'accepted'), gte(contributions.expiresAt, ctx.now()), gte(contributions.createdAt, cutoff)));
    for (const r of rows) {
      if (r.content.kind === 'strategy_choice' && !approvedStrategies.some((s) => s.id === (r.content as Extract<ContributionContent, { kind: 'strategy_choice' }>).strategyId)) continue;
      const [authorLink] = await ctx.db.select({ id: roleAssignments.id }).from(roleAssignments).where(and(eq(roleAssignments.userId, r.item.createdBy), eq(roleAssignments.role, r.item.sourceRole), eq(roleAssignments.studentId, studentId))).limit(1);
      if (authorLink) accepted.push({ id: r.item.id, revision: r.item.revision, sourceRole: r.item.sourceRole, content: r.content, acceptedAt: r.item.respondedAt });
    }
  }
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'plane.join', targetType: 'learner_profile', studentId, metadata: { sectionId } });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'profile.read', targetType: 'learner_profile', studentId, metadata: { sectionId, historyCount: history.length, sharedCount: shared.length } });
  return { student: { id: studentId, displayName: `${student.firstName} ${student.lastName}` }, sectionId, role, successes: shared.filter((s) => s.kind === 'positive_note'), updates: shared.filter((s) => s.kind !== 'positive_note'), history, acceptedContributions: accepted, strategies: approvedStrategies, caseKeys, memoryWindowDays: 120, coverageNote: 'Only current, confirmed observations are shown. Missing observations do not describe a learner’s engagement or ability.' };
}
