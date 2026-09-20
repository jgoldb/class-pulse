/**
 * Demo-data preparation for the recorded walkthroughs (demos/SERIES.md).
 *
 * The teacher UI can only log behavior events, strategy use and notes. Two seeded rules need
 * graded work and attendance before they can say anything, so those signals have to be written
 * the same way the seed writes them — through `logSignal`, with real dates.
 *
 * This adds, for two existing cases:
 *   - context-performance-divergence: independent work scoring well above group work;
 *   - attendance-performance-coupling: weeks with more absence scoring lower (support routing).
 *
 * Then it sweeps both cases so the candidates exist. Idempotent enough to re-run: the sweep
 * suppresses duplicates, but the signals would be added again, so run it once.
 *
 *   npx tsx src/demo-prep.ts
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { createApp } from './bootstrap';
import { caseLinks, students } from './db/schema';
import { buildActor } from './services/scope';
import { logSignal } from './services/signals';
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

  const keyFor = async (first: string) => {
    const [s] = await db.select().from(students).where(eq(students.firstName, first)).limit(1);
    if (!s) throw new Error(`no student ${first}`);
    const [c] = await db.select().from(caseLinks).where(eq(caseLinks.studentId, s.id)).limit(1);
    if (!c) throw new Error(`no case for ${first}`);
    return c.caseKey;
  };

  const blake = await keyFor('Blake');
  const casey = await keyFor('Casey');
  console.log({ blake, casey });

  /** Independent work well above group work, across five weeks. */
  async function divergence(caseKey: string) {
    for (let w = 0; w < 5; w++) {
      const base = 33 - w * 7;
      await logSignal(ctx, teacher, caseKey, { type: 'assessment_score', value: 90 + ((w * 3) % 6), contextTags: ['independent', 'summative', 'period_3'], observedAt: at(base - 1, 12), source: 'teacher_entry', sourceConfidence: 'high' });
      await logSignal(ctx, teacher, caseKey, { type: 'assignment_grade', value: 88 + ((w * 2) % 7), contextTags: ['independent', 'formative', 'period_3', 'short_task'], observedAt: at(base - 3, 12), source: 'teacher_entry', sourceConfidence: 'high' });
      await logSignal(ctx, teacher, caseKey, { type: 'assignment_grade', value: 59 + ((w * 4) % 8), contextTags: ['group_work', 'formative', 'period_3', 'long_assignment'], observedAt: at(base - 5, 12), source: 'teacher_entry', sourceConfidence: 'high' });
    }
  }

  /** Absence and grades moving together: the weeks with absences are the weaker weeks. */
  async function attendanceCoupling(caseKey: string) {
    // Week 0 is the worst attendance and the worst grades; week 4 the best of both.
    const absencesByWeek = [3, 2, 1, 1, 0];
    const gradeByWeek = [58, 66, 78, 82, 91];
    for (let w = 0; w < 5; w++) {
      const base = 33 - w * 7;
      for (let d = 0; d < 5; d++) {
        const absent = d < absencesByWeek[w]!;
        await logSignal(ctx, teacher, caseKey, { type: 'attendance', value: absent ? 0 : 1, contextTags: [], observedAt: at(base - d, 8), source: 'sis_import', sourceConfidence: 'high' });
      }
      await logSignal(ctx, teacher, caseKey, { type: 'assignment_grade', value: gradeByWeek[w]!, contextTags: ['independent', 'formative', 'period_3'], observedAt: at(base - 2, 12), source: 'teacher_entry', sourceConfidence: 'high' });
      await logSignal(ctx, teacher, caseKey, { type: 'assessment_score', value: gradeByWeek[w]! + 2, contextTags: ['independent', 'summative', 'period_3'], observedAt: at(base - 4, 12), source: 'teacher_entry', sourceConfidence: 'high' });
    }
  }

  console.log('Logging divergence signals for Casey and Blake…');
  await divergence(casey);
  await divergence(blake);
  console.log('Logging attendance-coupled signals for Blake…');
  await attendanceCoupling(blake);

  for (const [name, key] of [['Casey', casey], ['Blake', blake]] as const) {
    const r = await sweepOneCase(ctx, key);
    await ctx.queue.drain();
    console.log(`${name}: ${r.created} candidate(s) created, ${r.insufficient} insufficient note(s)`);
  }

  await app.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
