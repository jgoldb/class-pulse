/**
 * Demo-data preparation, part two (demos/SERIES.md, video 18).
 *
 * `attendance-performance-coupling` routes to the support team rather than the teacher queue, so
 * the series needs one case where it actually fires. It correlates weekly absence against weekly
 * graded work, which means the case must have no *other* graded work in those weeks — the first
 * prep script put divergence grades on Blake and flattened the correlation.
 *
 * So: open a fresh case for a student who has none, give it attendance and grades that move
 * together, and sweep.
 *
 *   npx tsx src/demo-prep2.ts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { EVAL_CASES } from '@class-pulse/ai/evals';
import { createApp } from './bootstrap';
import { caseLinks, students } from './db/schema';
import { buildActor } from './services/scope';
import { logSignal } from './services/signals';
import { submitIntake } from './services/cases';
import { sweepOneCase } from './services/patterns';

for (const candidate of [resolve(process.cwd(), '.env'), resolve(process.cwd(), '../../.env')]) {
  if (existsSync(candidate)) {
    try {
      process.loadEnvFile(candidate);
    } catch {
      /* ignore */
    }
    break;
  }
}

const DAY = 86_400_000;
const FIRST = 'Devon';

async function main() {
  const app = await createApp({ pollMs: 60_000 });
  const { ctx } = app;
  const db = ctx.db;
  const now = ctx.now();
  const at = (daysAgo: number, hour: number) => {
    const d = new Date(now.getTime() - daysAgo * DAY);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  const teacher = await buildActor(db, { id: 'u-teacher', email: 'teacher+clerk_test@example.com', displayName: 'Dana Whitfield' });

  const [student] = await db.select().from(students).where(eq(students.firstName, FIRST)).limit(1);
  if (!student) throw new Error(`no student ${FIRST}`);
  const [existing] = await db.select().from(caseLinks).where(eq(caseLinks.studentId, student.id)).limit(1);

  let caseKey = existing?.caseKey;
  if (!caseKey) {
    const source = EVAL_CASES.find((c) => c.id === '001')!;
    const r = await submitIntake(ctx, teacher, { studentId: student.id, fields: source.intake });
    caseKey = r.caseKey;
    console.log(`Opened case ${caseKey} for ${FIRST}; the draft generates in the background.`);
  } else {
    console.log(`${FIRST} already has case ${caseKey}`);
  }

  // Five calendar-aligned weeks. Absence falls, grades rise: one graded entry per week so the
  // weekly mean is exactly that entry and the correlation is not diluted.
  const absencesByWeek = [4, 3, 2, 1, 0];
  const gradeByWeek = [54, 63, 74, 83, 94];
  for (let w = 0; w < 5; w++) {
    const monday = 32 - w * 7;
    for (let d = 0; d < 5; d++) {
      await logSignal(ctx, teacher, caseKey, { type: 'attendance', value: d < absencesByWeek[w]! ? 0 : 1, contextTags: [], observedAt: at(monday - d, 8), source: 'sis_import', sourceConfidence: 'high' });
    }
    await logSignal(ctx, teacher, caseKey, { type: 'assignment_grade', value: gradeByWeek[w]!, contextTags: ['independent', 'formative', 'period_3'], observedAt: at(monday - 2, 12), source: 'teacher_entry', sourceConfidence: 'high' });
  }

  // The rule wants at least six graded entries. A sixth, equal to its own week's grade, adds the
  // entry without moving that week's mean.
  await logSignal(ctx, teacher, caseKey, { type: 'assessment_score', value: gradeByWeek[0]!, contextTags: ['independent', 'summative', 'period_3'], observedAt: at(32 - 3, 12), source: 'teacher_entry', sourceConfidence: 'high' });

  const r = await sweepOneCase(ctx, caseKey);
  await ctx.queue.drain();
  console.log(`${FIRST}: ${r.created} candidate(s) created, ${r.insufficient} insufficient note(s)`);

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
