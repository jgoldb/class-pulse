/**
 * Demo seed (demonstration posture: synthetic students only). Builds a district workspace, two
 * sections, real Clerk accounts for every role, and walks the core loop for one case through the
 * real model: intake → draft → approval → five weeks of logged signals → pattern sweep →
 * interpretation → an open review cycle.
 *
 *   npm run seed                 seed into DATABASE_URL (no-op if a workspace already exists)
 *   npm run seed -- --reset      drop everything first (used by the e2e harness on its own branch)
 *
 * Demo accounts use Clerk test addresses (`+clerk_test`) and the password in SEED_PASSWORD.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { newId } from '@class-pulse/domain';
import { EVAL_CASES } from '@class-pulse/ai/evals';
import { createApp } from './bootstrap';
import { caseLinks, cases, classSections, goals, organizations, planDrafts, reviewCycles, roleAssignments, schools, sectionEnrollments, students, subscriptions, users } from './db/schema';
import { submitIntake } from './services/cases';
import { approveDraft } from './services/plans';
import { openDueReviews } from './services/reviews';
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

export const DEMO_PASSWORD = process.env.SEED_PASSWORD || 'ClassPulse-demo-2026!';
export const DEMO_ACCOUNTS = [
  { key: 'teacher', email: 'teacher+clerk_test@example.com', firstName: 'Dana', lastName: 'Whitfield' },
  { key: 'teacher2', email: 'teacher2+clerk_test@example.com', firstName: 'Luis', lastName: 'Ortega' },
  { key: 'support', email: 'support+clerk_test@example.com', firstName: 'Priya', lastName: 'Natarajan' },
  { key: 'admin', email: 'admin+clerk_test@example.com', firstName: 'Marcus', lastName: 'Bell' },
  { key: 'student', email: 'student+clerk_test@example.com', firstName: 'Avery', lastName: 'Synthetic' },
  { key: 'guardian', email: 'guardian+clerk_test@example.com', firstName: 'Jordan', lastName: 'Synthetic' },
] as const;

const FIRST = ['Avery', 'Blake', 'Casey', 'Devon', 'Emery', 'Finley', 'Harper', 'Indigo', 'Jules', 'Kendall', 'Lane', 'Morgan', 'Noor', 'Oakley', 'Parker', 'Quinn', 'Reese', 'Sasha', 'Tatum', 'Umber', 'Vale', 'Wren', 'Xen', 'Yael', 'Zephyr', 'Arden'];
const LAST = ['Synthetic', 'Fictional', 'Sample', 'Demo', 'Placeholder', 'Example', 'Mock', 'Test'];
const DAY = 86_400_000;

async function main() {
  const reset = process.argv.includes('--reset');
  const app = await createApp({ pollMs: 60_000 });
  const { ctx } = app;
  const db = ctx.db;

  if (reset) {
    await db.execute(sql`DROP SCHEMA IF EXISTS working CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS identified CASCADE`);
    await db.execute(sql`DROP SCHEMA IF EXISTS drizzle CASCADE`);
    await app.close();
    console.log('Database reset. Re-running migrations…');
    return main2();
  }
  return main2(app);
}

async function ensureClerkUser(ctx: Awaited<ReturnType<typeof createApp>>['ctx'], a: (typeof DEMO_ACCOUNTS)[number]): Promise<string> {
  const client = ctx.auth.client;
  const existing = await client.users.getUserList({ emailAddress: [a.email], limit: 1 });
  if (existing.data[0]) {
    return existing.data[0].id;
  }
  const u = await client.users.createUser({ emailAddress: [a.email], password: DEMO_PASSWORD, firstName: a.firstName, lastName: a.lastName, skipPasswordChecks: true });
  return u.id;
}

async function main2(existingApp?: Awaited<ReturnType<typeof createApp>>) {
  const app = existingApp ?? (await createApp({ pollMs: 60_000 }));
  const { ctx } = app;
  const db = ctx.db;
  const existing = await db.select().from(organizations).limit(1);
  if (existing.length) {
    console.log('Already seeded. Run with --reset to start over.');
    await app.close();
    return;
  }
  if (!ctx.config.clerk) throw new Error('CLERK_SECRET_KEY is required to seed demo accounts');
  const now = ctx.now();

  // ---- Identified plane ---------------------------------------------------------------------
  const orgId = 'org-demo';
  const schoolId = 'school-riverside';
  await db.insert(organizations).values({ id: orgId, name: 'Demo Unified District (synthetic)', contextTagExtensions: [{ tag: 'lab_activity', dimension: 'structure' }] });
  await db.insert(schools).values({ id: schoolId, orgId, name: 'Riverside Middle School (synthetic)' });
  await db.insert(subscriptions).values({ id: newId(), orgId, plan: 'school', seats: 40, processor: 'simulated', processorRef: 'seed', status: 'active', currentPeriodEnd: new Date(now.getTime() + 30 * DAY) });
  const sec6 = 'sec-6-p3';
  const sec7 = 'sec-7-p2';
  await db.insert(classSections).values([
    { id: sec6, schoolId, name: 'Grade 6 — Period 3 Science', gradeLevel: '6', periodTag: 'period_3' },
    { id: sec7, schoolId, name: 'Grade 7 — Period 2 ELA', gradeLevel: '7', periodTag: 'period_2' },
  ]);

  console.log('Creating Clerk demo accounts…');
  const userIds: Record<string, string> = {};
  for (const a of DEMO_ACCOUNTS) {
    const subject = await ensureClerkUser(ctx, a);
    const id = `u-${a.key}`;
    await db.insert(users).values({ id, email: a.email, displayName: `${a.firstName} ${a.lastName}`, authSubject: subject });
    userIds[a.key] = id;
  }

  const studentIds: string[] = [];
  let n = 0;
  for (const [sectionId, grade, count] of [
    [sec6, '6', 14],
    [sec7, '7', 12],
  ] as const) {
    for (let i = 0; i < count; i++) {
      const id = `stu-${String(++n).padStart(3, '0')}`;
      studentIds.push(id);
      await db.insert(students).values({
        id,
        schoolId,
        firstName: FIRST[(n - 1) % FIRST.length]!,
        lastName: LAST[(n - 1) % LAST.length]!,
        gradeLevel: grade,
        demographics: { group: n % 3 === 0 ? 'beta' : 'alpha', program: n % 4 === 0 ? 'multilingual' : 'general' },
        synthetic: true,
      });
      await db.insert(sectionEnrollments).values({ sectionId, studentId: id });
    }
  }
  const studentA = studentIds[0]!;
  const studentB = studentIds[1]!;

  await db.insert(roleAssignments).values([
    { id: newId(), userId: userIds.teacher!, role: 'teacher', schoolId: null, sectionId: sec6, studentId: null },
    { id: newId(), userId: userIds.teacher2!, role: 'teacher', schoolId: null, sectionId: sec7, studentId: null },
    { id: newId(), userId: userIds.support!, role: 'support_professional', schoolId: null, sectionId: null, studentId: studentA },
    { id: newId(), userId: userIds.support!, role: 'support_professional', schoolId: null, sectionId: null, studentId: studentB },
    { id: newId(), userId: userIds.admin!, role: 'administrator', schoolId, sectionId: null, studentId: null },
    { id: newId(), userId: userIds.student!, role: 'student', schoolId: null, sectionId: null, studentId: studentA },
    { id: newId(), userId: userIds.guardian!, role: 'guardian', schoolId: null, sectionId: null, studentId: studentA },
  ]);

  // ---- Core loop for Student A ---------------------------------------------------------------
  const teacherActor = await buildActor(db, { id: userIds.teacher!, email: DEMO_ACCOUNTS[0].email, displayName: 'Dana Whitfield' });
  const source = EVAL_CASES.find((c) => c.id === '001')!;
  const { caseKey, draftId } = await submitIntake(ctx, teacherActor, { studentId: studentA, fields: source.intake });
  console.log(`Case ${caseKey} opened; generating draft through ${ctx.gate.providerName} (${ctx.aiConfig.model})…`);
  await ctx.queue.drain();
  const [draft] = await db.select().from(planDrafts).where(eq(planDrafts.id, draftId)).limit(1);
  if (!draft?.content || !['ready', 'needs_attention'].includes(draft.status)) {
    console.error('Draft did not reach a reviewable state:', draft?.status, draft?.error);
    await app.close();
    process.exit(1);
  }
  const approver = await buildActor(db, { id: userIds.teacher!, email: DEMO_ACCOUNTS[0].email, displayName: 'Dana Whitfield' });
  const { planId } = await approveDraft(ctx, approver, draftId, draft.content, 'Approved for the demo after reviewing every section.');
  console.log(`Plan ${planId} approved.`);
  const planGoals = await db.select().from(goals).where(eq(goals.planId, planId));

  const at = (daysAgo: number, hour: number) => {
    const d = new Date(now.getTime() - daysAgo * DAY);
    d.setHours(hour, 0, 0, 0);
    return d;
  };
  const log = (input: Record<string, unknown>) => logSignal(ctx, teacherActor, caseKey, { source: 'teacher_entry', sourceConfidence: 'high', ...input });
  for (let w = 0; w < 5; w++) {
    const base = 34 - w * 7;
    await log({ type: 'assessment_score', value: 88 + ((w * 7) % 9), contextTags: ['independent', 'summative', 'period_3'], observedAt: at(base - 1, 12) });
    await log({ type: 'assignment_grade', value: 85 + ((w * 3) % 10), contextTags: ['independent', 'formative', 'period_3', 'short_task'], observedAt: at(base - 3, 12) });
    await log({ type: 'assignment_grade', value: 58 + ((w * 5) % 10), contextTags: ['group_work', 'formative', 'period_3', 'long_assignment'], observedAt: at(base - 5, 12) });
    for (let d = 0; d < 5; d++) await log({ type: 'attendance', value: d === 2 && w % 2 === 0 ? 0 : 1, contextTags: [], observedAt: at(base - d, 8), source: 'sis_import', sourceConfidence: 'high' });
    for (const [i, g] of planGoals.entries()) {
      await log({ type: 'behavior_event', value: 1, contextTags: ['group_work', 'period_3', 'long_assignment', 'structured'], observedAt: at(base - 5, 10 + i), goalId: g.id });
      if (w % 2 === 1) await log({ type: 'behavior_event', value: 1, contextTags: ['independent', 'period_3', 'short_task', 'structured'], observedAt: at(base - 2, 10 + i), goalId: g.id });
    }
    await log({ type: 'strategy_use', value: 1, contextTags: ['group_work', 'period_3'], observedAt: at(base - 5, 9) });
    await log({ type: 'strategy_use', value: 1, contextTags: ['independent', 'period_3'], observedAt: at(base - 2, 9) });
  }
  const studentActor = await buildActor(db, { id: userIds.student!, email: DEMO_ACCOUNTS[4].email, displayName: 'Avery Synthetic' });
  for (let d = 12; d > 0; d -= 2) {
    await logSignal(ctx, studentActor, caseKey, { type: 'self_check', value: d > 6 ? 2 : 3, contextTags: ['period_3'], observedAt: at(d, 14), source: 'student_entry', sourceConfidence: 'medium', goalId: planGoals[0]?.id ?? null });
  }

  const sweep = await sweepOneCase(ctx, caseKey);
  await ctx.queue.drain();
  console.log(`Sweep: ${sweep.created} candidate(s), ${sweep.insufficient} insufficient-data note(s).`);

  await db.update(reviewCycles).set({ dueAt: new Date(now.getTime() - DAY) }).where(eq(reviewCycles.planId, planId));
  await openDueReviews(ctx);
  await ctx.queue.drain();
  console.log('Review cycle opened and narrated.');

  const rich = EVAL_CASES.find((c) => c.id === '008')!;
  const second = await submitIntake(ctx, teacherActor, { studentId: studentB, fields: rich.intake });
  await ctx.queue.drain();
  console.log(`Second case ${second.caseKey} has a draft awaiting review.`);

  const links = await db.select().from(caseLinks);
  const allCases = await db.select().from(cases);
  console.log(`\nSeed complete: ${studentIds.length} synthetic students, ${allCases.length} cases, ${links.length} case links.`);
  console.log(`Demo sign-in: ${DEMO_ACCOUNTS.map((a) => a.email).join(', ')}  password: ${DEMO_PASSWORD}`);
  await app.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
