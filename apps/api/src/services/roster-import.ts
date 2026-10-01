import { and, eq, inArray } from 'drizzle-orm';
import { newId, RosterImportRows, type RosterImportPreview, type RosterImportRow } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { badRequest } from '../context';
import type { Db } from '../db/client';
import { schools, sectionEnrollments, students } from '../db/schema';
import { assertTeachesSection } from './classroom';
import { audit } from './audit';

async function preview(db: Db, actor: Actor, sectionId: string, input: RosterImportRow[]) {
  const section = await assertTeachesSection(db, actor, sectionId);
  const rows = RosterImportRows.parse(input);
  const existing = await db.select().from(students).where(and(eq(students.schoolId, section.schoolId), inArray(students.externalId, rows.map((r) => r.externalId))));
  const enrolled = await db.select().from(sectionEnrollments).where(eq(sectionEnrollments.sectionId, sectionId));
  // A name match without an external ID is ambiguous: require manual reconciliation, never
  // create a second identity that would strand the existing family or support links.
  const schoolStudents = await db.select().from(students).where(eq(students.schoolId, section.schoolId));
  const sameName = (a: RosterImportRow, b: typeof students.$inferSelect) => a.firstName.toLowerCase() === b.firstName.toLowerCase() && a.lastName.toLowerCase() === b.lastName.toLowerCase();
  const result: RosterImportPreview = { canImport: true, rows: rows.map((r) => {
    const matches = existing.filter((s) => s.externalId === r.externalId);
    const s = matches[0];
    let reason: string | null = null;
    if (matches.length > 1 || (s && !actor.scope.identifiedStudentIds.has(s.id))) reason = 'Requires school administrator reconciliation';
    else if (s && (!sameName(r, s) || (r.gradeLevel && r.gradeLevel !== s.gradeLevel))) reason = 'Existing student details differ; reconcile before importing';
    else if (!s && schoolStudents.some((student) => sameName(r, student))) reason = 'Possible existing student; reconcile the external ID before importing';
    return { ...r, action: reason ? 'blocked' : !s ? 'create' : enrolled.some((e) => e.studentId === s.id) ? 'unchanged' : 'enroll', reason };
  }) };
  result.canImport = result.rows.every((r) => r.action !== 'blocked');
  return { result, section, existing };
}

export async function previewRosterImport(ctx: AppContext, actor: Actor, sectionId: string, rows: RosterImportRow[]) {
  const { result } = await preview(ctx.db, actor, sectionId, rows);
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'student.list', targetType: 'section', targetId: sectionId, metadata: { purpose: 'roster_import_preview', count: rows.length } });
  return result;
}

export async function confirmRosterImport(ctx: AppContext, actor: Actor, sectionId: string, rows: RosterImportRow[]) {
  const section = await assertTeachesSection(ctx.db, actor, sectionId);
  return ctx.db.transaction(async (tx) => {
    // Serialize imports across sections in the same school, including retries after lost replies.
    await tx.select().from(schools).where(eq(schools.id, section.schoolId)).for('update');
    const { result, existing } = await preview(tx, actor, sectionId, rows);
    if (!result.canImport) throw badRequest('Resolve the blocked rows before importing', result);
    let created = 0, added = 0;
    for (const row of result.rows) {
      if (row.action === 'unchanged') continue;
      let studentId = existing.find((s) => s.externalId === row.externalId)?.id;
      if (!studentId) {
        studentId = newId();
        await tx.insert(students).values({ id: studentId, schoolId: section.schoolId, firstName: row.firstName, lastName: row.lastName, gradeLevel: row.gradeLevel || section.gradeLevel, externalId: row.externalId, synthetic: ctx.config.deploymentPosture === 'demonstration' });
        created++;
      }
      await tx.insert(sectionEnrollments).values({ sectionId, studentId }).onConflictDoNothing();
      added++;
    }
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'roster.import', targetType: 'section', targetId: sectionId, metadata: { created, added, unchanged: rows.length - added } });
    return { created, added, unchanged: rows.length - added };
  });
}
