import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { newCaseKey, newId, roleScopeIsValid } from '@class-pulse/domain';
import type { Actor } from '../context';
import { badRequest, forbidden, notFound } from '../context';
import type { Db } from '../db/client';
import { authorizationRecords, caseLinks, cases, classSections, organizations, schools, sectionEnrollments, students, users } from '../db/schema';
import { audit } from './audit';

/**
 * Identified-plane operations. Every individual read here is audited (docs/04): if you cannot
 * answer "who looked at this student's record, and when", a district cannot adopt the system.
 */

export interface RosterStudent {
  id: string;
  displayName: string;
  gradeLevel: string;
  sectionId: string;
  sectionName: string;
  caseKeys: string[];
}

/** Students the actor may see by name: their own sections, assigned students, authorized students. */
export async function rosterFor(db: Db, actor: Actor): Promise<RosterStudent[]> {
  const ids = [...actor.scope.identifiedStudentIds];
  if (ids.length === 0) return [];
  const rows = await db
    .select({
      id: students.id,
      firstName: students.firstName,
      lastName: students.lastName,
      gradeLevel: students.gradeLevel,
      sectionId: sectionEnrollments.sectionId,
      sectionName: classSections.name,
    })
    .from(students)
    .innerJoin(sectionEnrollments, eq(sectionEnrollments.studentId, students.id))
    .innerJoin(classSections, eq(classSections.id, sectionEnrollments.sectionId))
    .where(inArray(students.id, ids));
  const links = await db.select().from(caseLinks).where(inArray(caseLinks.studentId, ids));
  await audit(db, { actorUserId: actor.userId, actorRole: null, action: 'student.list', targetType: 'student', metadata: { count: rows.length } });
  const seen = new Set<string>();
  const out: RosterStudent[] = [];
  for (const r of rows) {
    // Teachers see students through their own sections only; other roles through any section.
    if (actor.scope.teacherSectionIds.size && !actor.scope.teacherSectionIds.has(r.sectionId) && !actor.assignments.some((a) => a.studentId === r.id)) continue;
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({ id: r.id, displayName: `${r.firstName} ${r.lastName}`, gradeLevel: r.gradeLevel, sectionId: r.sectionId, sectionName: r.sectionName, caseKeys: links.filter((l) => l.studentId === r.id).map((l) => l.caseKey) });
  }
  return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** Plane join: caseKey → student display name. Audited every time. */
export async function studentForCase(db: Db, actor: Actor, caseKey: string): Promise<{ id: string; displayName: string } | null> {
  if (!actor.scope.caseRoles.has(caseKey)) throw forbidden();
  const [link] = await db.select().from(caseLinks).where(eq(caseLinks.caseKey, caseKey)).limit(1);
  if (!link) return null;
  if (!actor.scope.identifiedStudentIds.has(link.studentId)) return null; // students see no name lookups; guardians see their child
  const [s] = await db.select().from(students).where(eq(students.id, link.studentId)).limit(1);
  if (!s) return null;
  await audit(db, { actorUserId: actor.userId, actorRole: actor.scope.caseRoles.get(caseKey) ?? null, action: 'plane.join', targetType: 'case_link', targetId: caseKey, caseKey, studentId: s.id });
  return { id: s.id, displayName: `${s.firstName} ${s.lastName}` };
}

/**
 * Roster names for the PII denylist: every student in the case's school (names of classmates
 * leak just as badly as the subject's). Internal use by the generation job; not audited as a
 * read because no name is returned to a user.
 */
export async function denyNamesForCase(db: Db, caseKey: string): Promise<string[]> {
  const [c] = await db.select().from(cases).where(eq(cases.caseKey, caseKey)).limit(1);
  if (!c) return [];
  const rows = await db.select({ f: students.firstName, l: students.lastName }).from(students).where(eq(students.schoolId, c.schoolId));
  const names = new Set<string>();
  for (const r of rows) {
    names.add(`${r.f} ${r.l}`);
    names.add(r.f);
    names.add(r.l);
  }
  const staff = await db.select({ n: users.displayName }).from(users);
  for (const s of staff) names.add(s.n);
  return [...names].filter((n) => n.length >= 3);
}

export async function orgContextTags(db: Db, schoolId: string): Promise<Array<{ tag: string; dimension: string }>> {
  const [row] = await db
    .select({ ext: organizations.contextTagExtensions })
    .from(schools)
    .innerJoin(organizations, eq(organizations.id, schools.orgId))
    .where(eq(schools.id, schoolId))
    .limit(1);
  return row?.ext ?? [];
}

/** Open a case for a student (writes the link table). Teacher/support only, within scope. */
export async function openCaseForStudent(db: Db, actor: Actor, studentId: string): Promise<{ caseKey: string; sectionId: string; schoolId: string; gradeLevel: string }> {
  if (!actor.scope.identifiedStudentIds.has(studentId)) throw forbidden('Student is outside your assignment');
  const [s] = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  if (!s) throw notFound('Student not found');
  const enrollments = await db.select().from(sectionEnrollments).where(eq(sectionEnrollments.studentId, studentId));
  const section = enrollments.find((e) => actor.scope.teacherSectionIds.has(e.sectionId)) ?? enrollments[0];
  if (!section) throw badRequest('Student is not enrolled in a section');
  const role = actor.scope.teacherSectionIds.has(section.sectionId)
    ? ('teacher' as const)
    : actor.assignments.some((a) => a.role === 'support_professional' && a.studentId === studentId)
      ? ('support_professional' as const)
      : null;
  if (!role) throw forbidden('Only a teacher of the student\'s section or an assigned support professional can open a case');
  const caseKey = newCaseKey();
  await db.transaction(async (tx) => {
    await tx.insert(cases).values({ caseKey, gradeLevel: s.gradeLevel, sectionId: section.sectionId, schoolId: s.schoolId, status: 'open' });
    await tx.insert(caseLinks).values({ caseKey, studentId, createdBy: actor.userId });
  });
  // The actor's scope was resolved before this case existed; extend it for the rest of the request.
  actor.scope.caseRoles.set(caseKey, role);
  await audit(db, { actorUserId: actor.userId, actorRole: role, action: 'plane.join', targetType: 'case_link', targetId: caseKey, caseKey, studentId, metadata: { created: true } });
  return { caseKey, sectionId: section.sectionId, schoolId: s.schoolId, gradeLevel: s.gradeLevel };
}

// ---- Administrative individual access (docs/04 AuthorizationRecord) -----------------------

export async function grantAuthorization(db: Db, actor: Actor, input: { adminUserId: string; studentId: string; reason: string; days: number }) {
  if (!actor.roles.has('administrator')) throw forbidden('Only administrators can grant individual access');
  const [s] = await db.select().from(students).where(eq(students.id, input.studentId)).limit(1);
  if (!s) throw notFound('Student not found');
  const adminSchool = actor.assignments.find((a) => a.role === 'administrator' && a.schoolId === s.schoolId);
  if (!adminSchool) throw forbidden('Student is outside your school');
  const id = newId();
  const expiresAt = new Date(Date.now() + Math.min(Math.max(input.days, 1), 90) * 86_400_000);
  await db.insert(authorizationRecords).values({ id, adminUserId: input.adminUserId, studentId: input.studentId, grantedByUserId: actor.userId, reason: input.reason, expiresAt });
  await audit(db, { actorUserId: actor.userId, actorRole: 'administrator', action: 'authorization.grant', targetType: 'authorization_record', targetId: id, studentId: input.studentId, metadata: { adminUserId: input.adminUserId, reason: input.reason, expiresAt } });
  return { id, expiresAt };
}

export async function revokeAuthorization(db: Db, actor: Actor, id: string) {
  if (!actor.roles.has('administrator')) throw forbidden();
  const [rec] = await db.select().from(authorizationRecords).where(eq(authorizationRecords.id, id)).limit(1);
  if (!rec) throw notFound();
  await db.update(authorizationRecords).set({ revokedAt: new Date() }).where(eq(authorizationRecords.id, id));
  await audit(db, { actorUserId: actor.userId, actorRole: 'administrator', action: 'authorization.revoke', targetType: 'authorization_record', targetId: id, studentId: rec.studentId });
}

export async function listAuthorizations(db: Db, actor: Actor) {
  if (!actor.roles.has('administrator')) throw forbidden();
  const schoolIds = [...actor.scope.adminSchoolIds];
  if (!schoolIds.length) return [];
  const rows = await db
    .select({
      id: authorizationRecords.id,
      adminUserId: authorizationRecords.adminUserId,
      adminName: users.displayName,
      studentId: authorizationRecords.studentId,
      studentName: students.lastName,
      reason: authorizationRecords.reason,
      grantedAt: authorizationRecords.grantedAt,
      expiresAt: authorizationRecords.expiresAt,
      revokedAt: authorizationRecords.revokedAt,
    })
    .from(authorizationRecords)
    .innerJoin(users, eq(users.id, authorizationRecords.adminUserId))
    .innerJoin(students, eq(students.id, authorizationRecords.studentId))
    .where(inArray(students.schoolId, schoolIds));
  return rows.map((r) => ({ ...r, active: !r.revokedAt && r.expiresAt > new Date() }));
}

export async function activeAuthorizationsFor(db: Db, adminUserId: string) {
  return db
    .select()
    .from(authorizationRecords)
    .where(and(eq(authorizationRecords.adminUserId, adminUserId), isNull(authorizationRecords.revokedAt), gt(authorizationRecords.expiresAt, new Date())));
}

export function assertScopeValid(a: { role: string; schoolId: string | null; sectionId: string | null; studentId: string | null }) {
  if (!roleScopeIsValid(a as never)) throw badRequest(`Invalid scope for role ${a.role}: roles are scoped, never global`);
}
