import { and, desc, eq, inArray, ne } from 'drizzle-orm';
import { newId, type SectionCreate, type SectionUpdate } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import type { Db } from '../db/client';
import { classSections, classSessions, classroomEvents, invitations, roleAssignments, schools, sectionEnrollments, students, users } from '../db/schema';
import { audit } from './audit';

/**
 * The teacher's own class: sections they teach, the students in them, and the family and student
 * accounts they have opened onto those students.
 *
 * docs/04 keeps every role scoped, and this module is the teacher-scoped mirror of the
 * administrator's structure and invitation endpoints. A teacher may shape their own sections and
 * roster and may grant a guardian or a student access to that child — nothing wider. There is no
 * path here to another teacher's section, to a school-level role, or to a second teacher seat;
 * those stay with an administrator, where a seat is paid for and a school-wide grant belongs.
 */

/** The only roles a teacher can open onto a child, and so the only ones this surface lists. */
const FAMILY_ROLES = ['guardian', 'student'];

/** Sections the actor teaches, with the school each belongs to. */
export async function teacherSections(db: Db, actor: Actor) {
  const ids = [...actor.scope.teacherSectionIds];
  if (!ids.length) return [];
  return db.select().from(classSections).where(inArray(classSections.id, ids)).orderBy(classSections.name);
}

/** The section must be one the actor teaches. Returns it, so callers get the school for free. */
export async function assertTeachesSection(db: Db, actor: Actor, sectionId: string) {
  if (!actor.scope.teacherSectionIds.has(sectionId)) throw forbidden('That section is not one of yours');
  const [section] = await db.select().from(classSections).where(eq(classSections.id, sectionId)).limit(1);
  if (!section) throw notFound('Section not found');
  return section;
}

/**
 * The student must be one the actor is responsible for: enrolled in a section they teach, or
 * assigned to them as a support professional. Scope alone is not enough — an administrator with
 * a live authorization record also has the student in scope, and that grant is for reading a
 * record, not for opening accounts onto the child.
 */
export async function assertResponsibleFor(db: Db, actor: Actor, studentId: string) {
  const [student] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!student) throw notFound('Student not found');
  const enrolled = await db.select().from(sectionEnrollments).where(eq(sectionEnrollments.studentId, studentId));
  const teaches = enrolled.some((e) => actor.scope.teacherSectionIds.has(e.sectionId));
  const assigned = actor.assignments.some((a) => a.role === 'support_professional' && a.studentId === studentId);
  if (!teaches && !assigned) throw forbidden('That student is not in one of your sections');
  // The role the actor acts under here, for the audit trail. A support assignment outranks
  // teaching the section, the same precedence the scope resolver applies to reads.
  return { ...student, responsibleAs: (assigned ? 'support_professional' : 'teacher') as 'support_professional' | 'teacher' };
}

/** A teacher's school: the one their sections are in. Multi-school teachers name theirs explicitly. */
export async function teacherSchoolId(db: Db, actor: Actor, requested?: string | null): Promise<string> {
  const sections = await teacherSections(db, actor);
  const schoolIds = [...new Set(sections.map((s) => s.schoolId))];
  if (!schoolIds.length) throw forbidden('You do not teach a section yet');
  if (requested) {
    if (!schoolIds.includes(requested)) throw forbidden('That school is not one you teach in');
    return requested;
  }
  if (schoolIds.length > 1) throw badRequest('You teach in more than one school — say which one this belongs to');
  return schoolIds[0]!;
}

export interface SectionView {
  id: string; name: string; courseName: string | null; gradeLevel: string; periodTag: string | null; room: string | null; accent: string | null;
  schoolId: string; archivedAt: Date | null; updatedAt: Date;
  /** Everyone who teaches it. Shown read-only: reassigning a class is an administrator's call. */
  teachers: Array<{ id: string; name: string }>;
  /** Today's status in the school's timezone, from the actor's own sessions. */
  today: { status: 'not_started' | 'in_progress' | 'complete'; sessionId: string | null; observations: number };
}

const todayIn = (timezone: string, now: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);

/** Section rows shaped for the Classes page: teachers and today's status attached. */
async function sectionViews(ctx: AppContext, actor: Actor, sections: Array<typeof classSections.$inferSelect>, schoolRows: Array<typeof schools.$inferSelect>): Promise<SectionView[]> {
  if (!sections.length) return [];
  const ids = sections.map((s) => s.id);
  const teacherRows = await ctx.db
    .select({ sectionId: roleAssignments.sectionId, id: users.id, name: users.displayName })
    .from(roleAssignments)
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(and(inArray(roleAssignments.sectionId, ids), eq(roleAssignments.role, 'teacher')));
  const sessions = await ctx.db
    .select({ id: classSessions.id, sectionId: classSessions.sectionId, date: classSessions.date, endedAt: classSessions.endedAt })
    .from(classSessions)
    .where(and(inArray(classSessions.sectionId, ids), eq(classSessions.teacherId, actor.userId)))
    .orderBy(desc(classSessions.createdAt));
  const todays = sections.map((s) => {
    const tz = schoolRows.find((x) => x.id === s.schoolId)?.timezone ?? 'UTC';
    return sessions.find((x) => x.sectionId === s.id && x.date === todayIn(tz, ctx.now())) ?? null;
  });
  const sessionIds = todays.flatMap((t) => (t ? [t.id] : []));
  const events = sessionIds.length
    ? await ctx.db.select({ sessionId: classroomEvents.sessionId }).from(classroomEvents).where(and(inArray(classroomEvents.sessionId, sessionIds), eq(classroomEvents.createdBy, actor.userId), ne(classroomEvents.status, 'withdrawn')))
    : [];
  return sections.map((s, i) => {
    const t = todays[i];
    const teachers = [...new Map(teacherRows.filter((r) => r.sectionId === s.id).map((r) => [r.id, { id: r.id, name: r.name }])).values()];
    const status: SectionView['today']['status'] = !t ? 'not_started' : t.endedAt ? 'complete' : 'in_progress';
    return {
      id: s.id, name: s.name, courseName: s.courseName, gradeLevel: s.gradeLevel, periodTag: s.periodTag, room: s.room, accent: s.accent,
      schoolId: s.schoolId, archivedAt: s.archivedAt, updatedAt: s.updatedAt, teachers,
      today: { status, sessionId: t?.id ?? null, observations: t ? events.filter((e) => e.sessionId === t.id).length : 0 },
    };
  });
}

export interface ClassroomView {
  schools: Array<{ id: string; name: string }>;
  sections: SectionView[];
  students: Array<{ id: string; displayName: string; firstName: string; lastName: string; gradeLevel: string; sectionIds: string[] }>;
  /**
   * Guardian and student access to those students, so the teacher can see who has it: every
   * invitation, plus anyone holding the role assignment without an accepted invitation behind it.
   */
  access: Array<{ id: string; email: string; role: string; studentId: string | null; status: string; createdAt: Date; acceptedAt: Date | null; invitedByMe: boolean }>;
}

/** Everything the teacher's own class page needs, in one read. */
export async function classroomFor(ctx: AppContext, actor: Actor): Promise<ClassroomView> {
  const sections = await teacherSections(ctx.db, actor);
  if (!sections.length) return { schools: [], sections: [], students: [], access: [] };
  const sectionIds = sections.map((s) => s.id);
  const schoolRows = await ctx.db.select().from(schools).where(inArray(schools.id, [...new Set(sections.map((s) => s.schoolId))]));
  const enrollments = await ctx.db.select().from(sectionEnrollments).where(inArray(sectionEnrollments.sectionId, sectionIds));
  const studentIds = [...new Set(enrollments.map((e) => e.studentId))];
  const studentRows = studentIds.length ? await ctx.db.select().from(students).where(inArray(students.id, studentIds)) : [];
  const access = studentIds.length
    ? await ctx.db
        .select()
        .from(invitations)
        .where(and(inArray(invitations.studentId, studentIds), inArray(invitations.role, FAMILY_ROLES)))
        .orderBy(desc(invitations.createdAt))
    : [];
  const held = unlistedHolders(access, await familyHolders(ctx.db, studentIds));
  // A support professional reaches this surface too, and the trail should say which of them looked.
  const as = actor.roles.has('teacher') ? 'teacher' : 'support_professional';
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: as, action: 'student.list', targetType: 'student', metadata: { purpose: 'classroom', count: studentRows.length } });
  return {
    schools: schoolRows.map((s) => ({ id: s.id, name: s.name })),
    sections: await sectionViews(ctx, actor, sections, schoolRows),
    students: studentRows
      .map((s) => ({
        id: s.id,
        displayName: `${s.firstName} ${s.lastName}`,
        firstName: s.firstName,
        lastName: s.lastName,
        gradeLevel: s.gradeLevel,
        sectionIds: enrollments.filter((e) => e.studentId === s.id && sectionIds.includes(e.sectionId)).map((e) => e.sectionId),
      }))
      .sort((a, b) => a.displayName.localeCompare(b.displayName)),
    access: [
      ...access.map((a) => ({ id: a.id, email: a.email, role: a.role, studentId: a.studentId, status: a.status, createdAt: a.createdAt, acceptedAt: a.acceptedAt, invitedByMe: a.invitedBy === actor.userId })),
      ...held,
    ],
  };
}

/**
 * A new section, taught by the actor. The teacher role assignment is what makes it theirs.
 * Students typed into the Add Class flow are created in the same transaction, so a class is
 * never left half-made.
 */
export async function createSection(ctx: AppContext, actor: Actor, input: Omit<SectionCreate, 'students'> & { students?: SectionCreate['students'] }) {
  const schoolId = await teacherSchoolId(ctx.db, actor, input.schoolId);
  const id = newId();
  const created: string[] = [];
  await ctx.db.transaction(async (tx) => {
    await tx.insert(classSections).values({ id, schoolId, name: input.name, courseName: input.courseName ?? null, gradeLevel: input.gradeLevel, periodTag: input.periodTag ?? null, room: input.room ?? null, accent: input.accent ?? null });
    await tx.insert(roleAssignments).values({ id: newId(), userId: actor.userId, role: 'teacher', schoolId: null, sectionId: id, studentId: null });
    for (const st of input.students ?? []) {
      const studentId = newId();
      await tx.insert(students).values({ id: studentId, schoolId, firstName: st.firstName, lastName: st.lastName, gradeLevel: st.gradeLevel?.trim() || input.gradeLevel, externalId: null, synthetic: ctx.config.deploymentPosture === 'demonstration' });
      await tx.insert(sectionEnrollments).values({ sectionId: id, studentId });
      created.push(studentId);
    }
  });
  actor.scope.teacherSectionIds.add(id);
  for (const studentId of created) actor.scope.identifiedStudentIds.add(studentId);
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'section.update', targetType: 'section', targetId: id, metadata: { created: true, students: created.length } });
  return { id, schoolId, students: created.length };
}

/**
 * Edit a section's metadata in place (Pulsera UX spec §9.3–9.5). Only a teacher of the section may
 * do it, the id never changes, and nothing downstream is rewritten: sessions keep the period tag
 * they were opened with, so a new period applies to new sessions only.
 */
export async function updateSection(ctx: AppContext, actor: Actor, sectionId: string, input: SectionUpdate) {
  const section = await assertTeachesSection(ctx.db, actor, sectionId);
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== section.updatedAt.getTime()) {
    throw conflict('This class was changed somewhere else. Reload to see the latest details, then edit again.');
  }
  const { expectedUpdatedAt: _expected, ...fields } = input;
  const changed = (Object.keys(fields) as Array<keyof typeof fields>).filter((k) => fields[k] !== undefined && fields[k] !== section[k]);
  if (!changed.length) return sectionResponse(section);
  const [updated] = await ctx.db.update(classSections).set({ ...Object.fromEntries(changed.map((k) => [k, fields[k]])), updatedAt: ctx.now() }).where(eq(classSections.id, section.id)).returning();
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'section.update', targetType: 'section', targetId: section.id, metadata: { changed } });
  return sectionResponse(updated!);
}

function sectionResponse(s: typeof classSections.$inferSelect) {
  return { id: s.id, name: s.name, courseName: s.courseName, gradeLevel: s.gradeLevel, period: s.periodTag, periodTag: s.periodTag, room: s.room, accent: s.accent, archivedAt: s.archivedAt, updatedAt: s.updatedAt };
}

/** Archive rather than delete: every record stays, the class just stops taking new sessions. */
export async function setSectionArchived(ctx: AppContext, actor: Actor, sectionId: string, archived: boolean) {
  const section = await assertTeachesSection(ctx.db, actor, sectionId);
  if (!!section.archivedAt === archived) return sectionResponse(section);
  const [updated] = await ctx.db.update(classSections).set({ archivedAt: archived ? ctx.now() : null, updatedAt: ctx.now() }).where(eq(classSections.id, section.id)).returning();
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: archived ? 'section.archive' : 'section.restore', targetType: 'section', targetId: section.id });
  return sectionResponse(updated!);
}

/**
 * Take a student off one of the teacher's rosters. This removes the enrollment only: the student
 * record, their observations, drafts, approvals and support records all stay, and adding them
 * back restores the class view of that history. Family access granted onto the child is not
 * touched; revoking it is its own, visible action.
 */
export async function removeFromSection(ctx: AppContext, actor: Actor, sectionId: string, studentId: string) {
  const section = await assertTeachesSection(ctx.db, actor, sectionId);
  const removed = await ctx.db.delete(sectionEnrollments).where(and(eq(sectionEnrollments.sectionId, section.id), eq(sectionEnrollments.studentId, studentId))).returning();
  if (!removed.length) throw notFound('That student is not on this roster');
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'roster.remove', targetType: 'student', targetId: studentId, studentId, metadata: { sectionId: section.id } });
  return { ok: true };
}

/** A new student on the teacher's own roster. */
export async function createStudent(ctx: AppContext, actor: Actor, input: { sectionId: string; firstName: string; lastName: string; gradeLevel: string | null }) {
  const section = await assertTeachesSection(ctx.db, actor, input.sectionId);
  const id = newId();
  const gradeLevel = input.gradeLevel?.trim() || section.gradeLevel;
  await ctx.db.transaction(async (tx) => {
    await tx.insert(students).values({ id, schoolId: section.schoolId, firstName: input.firstName, lastName: input.lastName, gradeLevel, externalId: null, synthetic: ctx.config.deploymentPosture === 'demonstration' });
    await tx.insert(sectionEnrollments).values({ sectionId: section.id, studentId: id });
  });
  actor.scope.identifiedStudentIds.add(id);
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'student.list', targetType: 'student', targetId: id, studentId: id, metadata: { created: true, sectionId: section.id } });
  return { id, gradeLevel };
}

/** Move or add one of the teacher's own students to another of the teacher's own sections. */
export async function enrollStudent(ctx: AppContext, actor: Actor, input: { studentId: string; sectionId: string }) {
  const section = await assertTeachesSection(ctx.db, actor, input.sectionId);
  const student = await assertResponsibleFor(ctx.db, actor, input.studentId);
  if (student.schoolId !== section.schoolId) throw badRequest('That student is in a different school');
  await ctx.db.insert(sectionEnrollments).values({ sectionId: section.id, studentId: student.id }).onConflictDoNothing();
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'student.list', targetType: 'student', targetId: student.id, studentId: student.id, metadata: { enrolled: section.id } });
  return { ok: true };
}

/** Who currently holds guardian or student access to one of the teacher's students. */
export async function accessFor(db: Db, actor: Actor, studentId: string) {
  await assertResponsibleFor(db, actor, studentId);
  const rows = await db
    .select({ id: invitations.id, email: invitations.email, role: invitations.role, studentId: invitations.studentId, userId: invitations.userId, status: invitations.status, createdAt: invitations.createdAt, acceptedAt: invitations.acceptedAt, invitedBy: invitations.invitedBy, inviterName: users.displayName })
    .from(invitations)
    .innerJoin(users, eq(users.id, invitations.invitedBy))
    .where(and(eq(invitations.studentId, studentId), inArray(invitations.role, FAMILY_ROLES)))
    .orderBy(desc(invitations.createdAt));
  const invited = rows.map(({ userId: _userId, studentId: _studentId, ...r }) => ({ ...r, invitedByMe: r.invitedBy === actor.userId }));
  const held = unlistedHolders(rows, await familyHolders(db, [studentId]));
  return [...invited, ...held.map(({ studentId: _studentId, ...h }) => h)];
}

/**
 * Guardian and student role assignments on these students, with the holder's email. Access is
 * held through the assignment, not the invitation: an invitation is only one way an assignment
 * comes to exist (the seed and workspace onboarding make them directly), so a list built from
 * invitations alone would say nobody at home has access while somebody does.
 *
 * Role assignments are never soft-revoked — there is no revokedAt or active column, and nothing
 * deletes them — so every row is live access.
 */
async function familyHolders(db: Db, studentIds: string[]) {
  if (!studentIds.length) return [];
  return db
    .select({ id: roleAssignments.id, userId: roleAssignments.userId, role: roleAssignments.role, studentId: roleAssignments.studentId, email: users.email, userCreatedAt: users.createdAt })
    .from(roleAssignments)
    .innerJoin(users, eq(users.id, roleAssignments.userId))
    .where(and(inArray(roleAssignments.studentId, studentIds), inArray(roleAssignments.role, FAMILY_ROLES)));
}

/**
 * The holders an accepted invitation has not already listed, shaped like an accepted invitation.
 * The id is the role assignment's own, so it can never be mistaken for an invitation by the
 * revoke endpoint (which only looks up pending invitation rows). The assignment table carries no
 * timestamp; the account's creation is the closest honest date for when access began.
 */
function unlistedHolders(
  invited: Array<{ email: string; role: string; studentId: string | null; userId: string | null; status: string }>,
  holders: Awaited<ReturnType<typeof familyHolders>>,
) {
  const key = (who: string, role: string, studentId: string | null) => `${who.toLowerCase()}|${role}|${studentId ?? ''}`;
  const listed = new Set<string>();
  for (const inv of invited) {
    if (inv.status !== 'accepted') continue;
    listed.add(key(inv.email, inv.role, inv.studentId));
    if (inv.userId) listed.add(key(inv.userId, inv.role, inv.studentId));
  }
  const seen = new Set<string>();
  return holders
    .filter((h) => {
      const k = key(h.userId, h.role, h.studentId);
      if (seen.has(k) || listed.has(k) || listed.has(key(h.email, h.role, h.studentId))) return false;
      seen.add(k);
      return true;
    })
    .map((h) => ({ id: h.id, email: h.email, role: h.role, studentId: h.studentId, status: 'accepted', createdAt: h.userCreatedAt, acceptedAt: null as Date | null, invitedByMe: false }));
}
