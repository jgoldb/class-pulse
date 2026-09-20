import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import type { Role, RoleAssignment } from '@class-pulse/domain';
import { resolveScope, type Scope } from '@class-pulse/policy';
import type { Actor } from '../context';
import type { Db } from '../db/client';
import { authorizationRecords, caseLinks, cases, roleAssignments, sectionEnrollments } from '../db/schema';

/**
 * The policy service's first layer (docs/05): resolve a user's row scope from role assignments,
 * roster, the link table and live authorization records. The decision itself is the pure
 * function in @class-pulse/policy; this only gathers inputs.
 *
 * Reading identified.case_links here is a plane join, but it is a *structural* one performed on
 * behalf of the caller's own scope; it never returns names. Individual student reads are audited
 * separately in the roster service.
 */
export async function buildActor(db: Db, user: { id: string; email: string; displayName: string }): Promise<Actor> {
  const assignments = (await db.select().from(roleAssignments).where(eq(roleAssignments.userId, user.id))) as RoleAssignment[];
  const sectionIds = assignments.filter((a) => a.role === 'teacher' && a.sectionId).map((a) => a.sectionId!);
  const directStudentIds = assignments.filter((a) => a.studentId).map((a) => a.studentId!);

  const sectionStudents = new Map<string, string[]>();
  if (sectionIds.length) {
    const rows = await db.select().from(sectionEnrollments).where(inArray(sectionEnrollments.sectionId, sectionIds));
    for (const r of rows) {
      if (!sectionStudents.has(r.sectionId)) sectionStudents.set(r.sectionId, []);
      sectionStudents.get(r.sectionId)!.push(r.studentId);
    }
  }

  const authorized = await db
    .select({ studentId: authorizationRecords.studentId })
    .from(authorizationRecords)
    .where(and(eq(authorizationRecords.adminUserId, user.id), isNull(authorizationRecords.revokedAt), gt(authorizationRecords.expiresAt, new Date())));
  const authorizedStudentIds = authorized.map((a) => a.studentId);

  const allStudentIds = [...new Set([...directStudentIds, ...authorizedStudentIds, ...[...sectionStudents.values()].flat()])];
  const studentCases = new Map<string, string[]>();
  if (allStudentIds.length) {
    const links = await db.select().from(caseLinks).where(inArray(caseLinks.studentId, allStudentIds));
    for (const l of links) {
      if (!studentCases.has(l.studentId)) studentCases.set(l.studentId, []);
      studentCases.get(l.studentId)!.push(l.caseKey);
    }
  }

  const caseSections = new Map<string, string>();
  if (sectionIds.length) {
    const rows = await db.select({ caseKey: cases.caseKey, sectionId: cases.sectionId }).from(cases).where(inArray(cases.sectionId, sectionIds));
    for (const r of rows) caseSections.set(r.caseKey, r.sectionId);
  }

  const scope: Scope = resolveScope({ assignments, sectionStudents, studentCases, authorizedStudentIds, caseSections });
  return { userId: user.id, email: user.email, displayName: user.displayName, assignments, roles: new Set(assignments.map((a) => a.role as Role)), scope };
}
