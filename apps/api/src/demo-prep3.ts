/**
 * Demo-data preparation, part three (demos/SERIES.md, video 18).
 *
 * The support-routed candidate sits on Devon's case, but the seeded support professional is only
 * assigned to two other students, so it would not reach her queue. Normally that assignment is
 * created when someone accepts an invitation; this writes the same end state directly.
 *
 *   npx tsx src/demo-prep3.ts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { newId } from '@class-pulse/domain';
import { createApp } from './bootstrap';
import { roleAssignments, students } from './db/schema';

for (const c of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(c)) { try { process.loadEnvFile(c); } catch { /* ignore */ } break; }
}

async function main() {
  const app = await createApp({ pollMs: 60_000 });
  const db = app.ctx.db;
  const [student] = await db.select().from(students).where(eq(students.firstName, 'Devon')).limit(1);
  if (!student) throw new Error('no Devon');
  const existing = await db.select().from(roleAssignments).where(and(eq(roleAssignments.userId, 'u-support'), eq(roleAssignments.studentId, student.id)));
  if (existing.length) console.log('already assigned');
  else {
    await db.insert(roleAssignments).values({ id: newId(), userId: 'u-support', role: 'support_professional', schoolId: null, sectionId: null, studentId: student.id });
    console.log(`support professional assigned to ${student.firstName} ${student.lastName}`);
  }
  await app.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
