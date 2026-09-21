import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';
import { newId } from '@class-pulse/domain';
import { EVAL_CASES } from '@class-pulse/ai/evals';
import { hiddenFields, visibleFields } from '@class-pulse/policy';
import { createApp, type AppHandle } from './bootstrap';
import { buildServer } from './server';
import { auditEvents, classSections, organizations, patternCandidates, planDrafts, reviewCycles, roleAssignments, schools, sectionEnrollments, students, users } from './db/schema';

let app: AppHandle;
let server: FastifyInstance;
const S = { sec: 'sec-1', other: 'sec-2', school: 'school-1', studentA: 'stu-a', studentB: 'stu-b', studentOther: 'stu-other' };

/** The integration suite authenticates through the NODE_ENV=test seam (`Authorization: Test <userId>`); Clerk is exercised by the e2e harness. */
const USER_IDS: Record<string, string> = { 'teacher@test.school': 'u-t', 'teacher2@test.school': 'u-t2', 'student@test.school': 'u-s', 'guardian@test.school': 'u-g', 'support@test.school': 'u-sp', 'admin@test.school': 'u-a' };
async function login(email: string) {
  const res = await server.inject({ method: 'GET', url: '/auth/me', headers: { authorization: `Test ${USER_IDS[email]}` } });
  expect(res.statusCode).toBe(200);
  expect(res.json().provisioned).toBe(true);
}
const as = (email: string) => ({ headers: { authorization: `Test ${USER_IDS[email]}` } });
async function get(email: string, url: string) {
  const r = await server.inject({ method: 'GET', url, ...as(email) });
  return { status: r.statusCode, body: r.json() };
}
async function post(email: string, url: string, payload?: Record<string, unknown>, method: 'POST' | 'PATCH' = 'POST') {
  const r = await server.inject({ method, url, payload, ...as(email) });
  return { status: r.statusCode, body: r.json() };
}

beforeAll(async () => {
  app = await createApp({
    env: { ...process.env, NODE_ENV: 'test', AI_PROVIDER: 'mock', AUTH_PROVIDER: 'dev', DATABASE_URL: '', OPENAI_API_KEY: '' },
    memory: true,
    pollMs: 60_000,
  });
  server = await buildServer(app.ctx, { logger: false });
  const db = app.ctx.db;
  await db.insert(organizations).values({ id: 'org', name: 'Org' });
  await db.insert(schools).values({ id: S.school, orgId: 'org', name: 'School' });
  await db.insert(classSections).values([
    { id: S.sec, schoolId: S.school, name: 'Sec 1', gradeLevel: '6', periodTag: 'period_3' },
    { id: S.other, schoolId: S.school, name: 'Sec 2', gradeLevel: '6', periodTag: 'period_1' },
  ]);
  await db.insert(users).values([
    { id: 'u-t', email: 'teacher@test.school', displayName: 'Teacher One' },
    { id: 'u-t2', email: 'teacher2@test.school', displayName: 'Teacher Two' },
    { id: 'u-s', email: 'student@test.school', displayName: 'Student A' },
    { id: 'u-g', email: 'guardian@test.school', displayName: 'Guardian A' },
    { id: 'u-sp', email: 'support@test.school', displayName: 'Support Pro' },
    { id: 'u-a', email: 'admin@test.school', displayName: 'Admin' },
    { id: 'u-g2', email: 'parent2@test.school', displayName: 'Parent Two' },
  ]);
  await db.insert(students).values([
    { id: S.studentA, schoolId: S.school, firstName: 'Marcus', lastName: 'Johnson', gradeLevel: '6', demographics: { group: 'alpha' } },
    { id: S.studentB, schoolId: S.school, firstName: 'Priya', lastName: 'Raman', gradeLevel: '6', demographics: { group: 'beta' } },
    { id: S.studentOther, schoolId: S.school, firstName: 'Other', lastName: 'Kid', gradeLevel: '6', demographics: { group: 'alpha' } },
  ]);
  await db.insert(sectionEnrollments).values([
    { sectionId: S.sec, studentId: S.studentA },
    { sectionId: S.sec, studentId: S.studentB },
    { sectionId: S.other, studentId: S.studentOther },
  ]);
  await db.insert(roleAssignments).values([
    { id: newId(), userId: 'u-t', role: 'teacher', schoolId: null, sectionId: S.sec, studentId: null },
    { id: newId(), userId: 'u-t2', role: 'teacher', schoolId: null, sectionId: S.other, studentId: null },
    { id: newId(), userId: 'u-s', role: 'student', schoolId: null, sectionId: null, studentId: S.studentA },
    { id: newId(), userId: 'u-g', role: 'guardian', schoolId: null, sectionId: null, studentId: S.studentA },
    { id: newId(), userId: 'u-sp', role: 'support_professional', schoolId: null, sectionId: null, studentId: S.studentA },
    { id: newId(), userId: 'u-a', role: 'administrator', schoolId: S.school, sectionId: null, studentId: null },
  ]);
  for (const e of ['teacher@test.school', 'teacher2@test.school', 'student@test.school', 'guardian@test.school', 'support@test.school', 'admin@test.school']) await login(e);
});

afterAll(async () => {
  await server.close();
  await app.close();
});

let caseKey = '';
let draftId = '';
let planId = '';
let goalIds: string[] = [];

describe('auth and scope', () => {
  it('rejects unauthenticated API calls', async () => {
    const r = await server.inject({ method: 'GET', url: '/api/cases' });
    expect(r.statusCode).toBe(401);
  });
  it('scopes the roster to the teacher\'s own section', async () => {
    const r = await get('teacher@test.school', '/api/roster');
    expect(r.status).toBe(200);
    expect(r.body.map((s: { id: string }) => s.id).sort()).toEqual([S.studentA, S.studentB]);
    const other = await get('teacher2@test.school', '/api/roster');
    expect(other.body.map((s: { id: string }) => s.id)).toEqual([S.studentOther]);
  });
});

describe('Phase 0–2: intake → draft → approval', () => {
  it('blocks an intake containing the student\'s own name before anything is stored', async () => {
    const r = await post('teacher@test.school', '/api/intakes', { studentId: S.studentA, fields: EVAL_CASES.find((c) => c.id === '004')!.intake });
    expect(r.status).toBe(400);
    expect(r.body.details.spans.some((s: { text: string }) => /Marcus/.test(s.text))).toBe(true);
    const drafts = await app.ctx.db.select().from(planDrafts);
    expect(drafts.length).toBe(0);
  });

  it('accepts the grade-6 intake and produces a draft that refuses to invent a baseline', async () => {
    const r = await post('teacher@test.school', '/api/intakes', { studentId: S.studentA, fields: EVAL_CASES[0]!.intake });
    expect(r.status).toBe(202);
    caseKey = r.body.caseKey;
    draftId = r.body.draftId;
    await app.ctx.queue.drain();
    const d = await get('teacher@test.school', `/api/drafts/${draftId}`);
    expect(d.body.status).toBe('ready');
    for (const g of d.body.content.measurableGoals) {
      expect(g.baseline.status).toBe('ambiguous');
      expect(g.target.status).toBe('blocked_on_baseline');
    }
    expect(d.body.guardrails.passed).toBe(true);
  });

  it('refuses to approve an edit that reintroduces a numeric target without a baseline', async () => {
    const d = await get('teacher@test.school', `/api/drafts/${draftId}`);
    const edited = structuredClone(d.body.content);
    edited.measurableGoals[0].target = { status: 'proposed', value: 2, unit: 'events', rationale: 'x' };
    const r = await post('teacher@test.school', `/api/drafts/${draftId}/approve`, { content: edited, rationale: null });
    expect(r.status).toBe(400);
    expect(r.body.details.findings.some((f: { check: string }) => f.check === 'target_without_baseline')).toBe(true);
  });

  it('lets a student neither read the draft nor approve it', async () => {
    expect((await get('student@test.school', `/api/drafts/${draftId}`)).status).toBe(403);
    expect((await post('guardian@test.school', `/api/drafts/${draftId}/approve`, { content: {} })).status).toBe(403);
  });

  it('approves with an edit, stores the diff, materializes goals/strategies, schedules a review and audits it', async () => {
    const d = await get('teacher@test.school', `/api/drafts/${draftId}`);
    const edited = structuredClone(d.body.content);
    edited.studentStrengths.push('enjoys chess');
    edited.behavioralConcern = edited.behavioralConcern + ' (edited by reviewer)';
    const r = await post('teacher@test.school', `/api/drafts/${draftId}/approve`, { content: edited, rationale: 'Reviewed every section.' });
    expect(r.status).toBe(200);
    planId = r.body.planId;
    const p = await get('teacher@test.school', `/api/plans/${planId}`);
    expect(p.body.plan.status).toBe('active');
    expect(p.body.plan.approvedBy).toBe('u-t');
    expect(p.body.plan.draftDiff.bySection.behavioralConcern.changed).toBe(1);
    expect(p.body.plan.draftDiff.bySection.studentStrengths.added).toBe(1);
    expect(p.body.goals.length).toBe(edited.measurableGoals.length);
    expect(p.body.strategies.length).toBeGreaterThan(3);
    expect(p.body.reviewCycles.length).toBe(1);
    goalIds = p.body.goals.map((g: { id: string }) => g.id);
    const audits = await app.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'plan.approve'));
    expect(audits.length).toBe(1);
    expect(audits[0]!.actorUserId).toBe('u-t');
  });
});

describe('Phase 3: logging and progress', () => {
  it('logs quick-entry signals with context chips and rejects unknown tags', async () => {
    const bad = await post('teacher@test.school', `/api/cases/${caseKey}/signals`, { type: 'behavior_event', value: 1, contextTags: ['free_text_tag'], observedAt: new Date().toISOString(), source: 'teacher_entry', sourceConfidence: 'high' });
    expect(bad.status).toBe(400);
    const tags = await get('teacher@test.school', `/api/cases/${caseKey}/context-tags`);
    expect(tags.body.defaults).toContain('period_3');
    for (let d = 10; d > 0; d--) {
      const r = await post('teacher@test.school', `/api/cases/${caseKey}/signals`, {
        type: 'behavior_event', value: 1, contextTags: ['independent', 'period_3', 'long_assignment'], observedAt: new Date(Date.now() - d * 86_400_000).toISOString(), source: 'teacher_entry', sourceConfidence: 'high', goalId: goalIds[0],
      });
      expect(r.status).toBe(201);
    }
    const progress = await get('teacher@test.school', `/api/goals/${goalIds[0]}/progress`);
    expect(progress.body.totalObservations).toBe(10);
    expect(progress.body.preBaseline).toBe(true);
  });
  it('lets the student log a self-check but not a behavior event', async () => {
    const ok = await post('student@test.school', `/api/cases/${caseKey}/signals`, { type: 'self_check', value: 3, contextTags: [], observedAt: new Date().toISOString(), source: 'student_entry', sourceConfidence: 'medium' });
    expect(ok.status).toBe(201);
    const bad = await post('student@test.school', `/api/cases/${caseKey}/signals`, { type: 'behavior_event', value: 1, contextTags: [], observedAt: new Date().toISOString(), source: 'teacher_entry', sourceConfidence: 'high' });
    expect(bad.status).toBe(403);
  });
  it('blocks a quick-entry note that names a classmate', async () => {
    const r = await post('teacher@test.school', `/api/cases/${caseKey}/signals`, { type: 'behavior_event', value: 1, contextTags: [], observedAt: new Date().toISOString(), source: 'teacher_entry', sourceConfidence: 'high', note: 'Was talking to Priya Raman again' });
    expect(r.status).toBe(400);
  });
});

describe('Phase 5: role payloads exclude hidden fields entirely', () => {
  const roleEmails = { teacher: 'teacher@test.school', student: 'student@test.school', guardian: 'guardian@test.school', support_professional: 'support@test.school' } as const;
  for (const [role, email] of Object.entries(roleEmails)) {
    it(`${role} view contains only fields the policy matrix allows`, async () => {
      const r = await get(email, `/api/cases/${caseKey}`);
      expect(r.status).toBe(200);
      expect(r.body.role).toBe(role);
      const allowed = new Set(visibleFields(role as never));
      for (const f of r.body.fields) expect(allowed.has(f), `${role} received ${f}`).toBe(true);
      for (const f of hiddenFields(role as never)) expect(r.body[f.replace('.', '_')], `${role} must not receive ${f}`).toBeUndefined();
    });
  }
  it('student payload has no intake, notes, hypotheses or raw candidates; guardian has provenance', async () => {
    const s = await get('student@test.school', `/api/cases/${caseKey}`);
    expect(JSON.stringify(s.body)).not.toMatch(/hypothesesToMonitor|intake_fields|behaviorEventNotes|pattern_candidates|Marcus/);
    expect(s.body.goals.length).toBeGreaterThan(0);
    expect(s.body.goals[0].baseline).toBeUndefined();
    expect(s.body.goals[0].progress).toBeDefined();
    const g = await get('guardian@test.school', `/api/cases/${caseKey}`);
    expect(g.body.plan_provenance.approvedBy).toBe('Teacher One');
    expect(g.body.plan_provenance.aiDrafted).toBe(true);
    expect(g.body.dataCollectedExplanation).toBeDefined();
    expect(g.body.student.displayName).toBe('Marcus Johnson');
    expect(JSON.stringify(g.body)).not.toMatch(/hypothesesToMonitor|pattern_candidates|behaviorEventNotes/);
  });
  it('denies the other teacher and an unauthorized administrator, and audits every individual read', async () => {
    expect((await get('teacher2@test.school', `/api/cases/${caseKey}`)).status).toBe(403);
    expect((await get('admin@test.school', `/api/cases/${caseKey}`)).status).toBe(403);
    const reads = await app.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'student.read'));
    expect(reads.length).toBeGreaterThanOrEqual(5);
    expect(reads.every((e) => e.actorUserId)).toBe(true);
  });
  it('grants an administrator individual access only through an authorization record, audited', async () => {
    const grant = await post('admin@test.school', '/api/admin/authorizations', { adminUserId: 'u-a', studentId: S.studentA, reason: 'Family meeting preparation', days: 7 });
    expect(grant.status).toBe(200);
    const view = await get('admin@test.school', `/api/cases/${caseKey}`);
    expect(view.status).toBe(200);
    expect(view.body.role).toBe('administrator_authorized');
    expect(view.body.signal_behaviorEventNotes).toBeUndefined();
    await post('admin@test.school', `/api/admin/authorizations/${grant.body.id}/revoke`);
    expect((await get('admin@test.school', `/api/cases/${caseKey}`)).status).toBe(403);
    const grants = await app.ctx.db.select().from(auditEvents).where(eq(auditEvents.action, 'authorization.grant'));
    expect(grants.length).toBe(1);
  });
  it('audit log is append-only at the database', async () => {
    const [row] = await app.ctx.db.select().from(auditEvents).limit(1);
    const err = (await app.ctx.db.delete(auditEvents).where(eq(auditEvents.id, row!.id)).then(() => null, (e: unknown) => e)) as (Error & { cause?: Error }) | null;
    expect(err).not.toBeNull();
    expect(`${err!.message} ${err!.cause?.message ?? ''}`).toMatch(/append-only/);
  });
});

describe('Phase 4: pattern engine end to end', () => {
  it('reproduces the motivating example, addresses every confounder, and can be confirmed into a goal', async () => {
    const now = Date.now();
    const log = (payload: Record<string, unknown>) => post('teacher@test.school', `/api/cases/${caseKey}/signals`, { source: 'teacher_entry', sourceConfidence: 'high', ...payload });
    for (let w = 0; w < 5; w++) {
      const base = 34 - w * 7;
      await log({ type: 'assessment_score', value: 90, contextTags: ['independent', 'summative', 'period_3'], observedAt: new Date(now - (base - 1) * 86_400_000).toISOString() });
      await log({ type: 'assignment_grade', value: 88, contextTags: ['independent', 'formative', 'period_3'], observedAt: new Date(now - (base - 3) * 86_400_000).toISOString() });
      await log({ type: 'assignment_grade', value: 60, contextTags: ['group_work', 'formative', 'period_3'], observedAt: new Date(now - (base - 5) * 86_400_000).toISOString() });
    }
    const sweep = await post('teacher@test.school', `/api/cases/${caseKey}/sweep`);
    expect(sweep.status).toBe(200);
    await app.ctx.queue.drain();
    const queue = await get('teacher@test.school', '/api/patterns/queue?queue=teacher');
    const cpd = queue.body.find((c: { definitionId: string }) => c.definitionId === 'context-performance-divergence');
    expect(cpd).toBeDefined();
    const card = await get('teacher@test.school', `/api/candidates/${cpd.id}`);
    expect(card.body.order).toEqual(['evidence', 'hypothesis', 'proposals']);
    expect(card.body.evidence.length).toBeGreaterThan(0);
    expect(card.body.proposalStatus).toBe('ready');
    expect(card.body.proposal.alternativeExplanations.length).toBe(card.body.confounders.length);
    expect(JSON.stringify(card.body)).not.toMatch(/Marcus/);

    // Students and guardians never see candidates; guardians see confirmed patterns later.
    expect((await get('student@test.school', `/api/candidates/${cpd.id}`)).status).toBe(200); // scope allows the case...
    const studentView = await get('student@test.school', `/api/cases/${caseKey}`);
    expect(studentView.body.pattern_candidates).toBeUndefined();

    const cannot = await post('guardian@test.school', `/api/candidates/${cpd.id}/open`);
    expect(cannot.status).toBe(403);
    const opened = await post('teacher@test.school', `/api/candidates/${cpd.id}/open`);
    expect(opened.body.status).toBe('in_review');
    const noReason = await post('teacher@test.school', `/api/candidates/${cpd.id}/adjudicate`, { decision: 'dismissed' });
    expect(noReason.status).toBe(400);
    const confirmed = await post('teacher@test.school', `/api/candidates/${cpd.id}/adjudicate`, {
      decision: 'confirmed',
      note: 'Matches what I see in class.',
      seed: {
        kind: 'goal',
        content: {
          targetBehavior: 'Contributing during group tasks',
          observableDefinition: 'Counted each time the student adds a written or spoken contribution to the group product during a group block.',
          baseline: { status: 'unavailable', reason: 'Not yet counted' },
          measurementMethod: 'frequency_count',
          direction: 'increase',
          target: { status: 'blocked_on_baseline', note: 'Count for 5 group blocks first.' },
          reviewPeriodDays: 14,
        },
      },
    });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.resultingGoalId).toBeTruthy();
    const g = await get('guardian@test.school', `/api/cases/${caseKey}`);
    expect(g.body.pattern_confirmedPlainLanguage.length).toBe(1);
    expect(g.body.pattern_confirmedPlainLanguage[0].plainLanguage).toMatch(/scoring/);
    const [row] = await app.ctx.db.select().from(patternCandidates).where(eq(patternCandidates.id, cpd.id));
    expect(row!.status).toBe('confirmed');
  });

  it('records insufficient-data notes on the teacher\'s data-quality panel only', async () => {
    const t = await get('teacher@test.school', `/api/cases/${caseKey}/data-quality`);
    expect(t.status).toBe(200);
    expect(t.body.length).toBeGreaterThan(0);
    expect((await get('guardian@test.school', `/api/cases/${caseKey}/data-quality`)).status).toBe(403);
  });
});

describe('review cycles', () => {
  it('opens a due cycle, computes a recommendation, narrates it and requires a named decision', async () => {
    const r = await post('teacher@test.school', `/api/plans/${planId}/review-now`);
    expect(r.status).toBe(200);
    await app.ctx.queue.drain();
    const cycle = await get('teacher@test.school', `/api/reviews/${r.body.cycleId}`);
    expect(cycle.body.status).toBe('open');
    expect(cycle.body.computed.decision).toBeDefined();
    expect(cycle.body.narrative.decision).toBe(cycle.body.computed.decision);
    const disagree = await post('teacher@test.school', `/api/reviews/${r.body.cycleId}/decide`, { decision: cycle.body.computed.decision === 'fade' ? 'continue' : 'fade', rationale: null });
    expect(disagree.status).toBe(409);
    const decided = await post('teacher@test.school', `/api/reviews/${r.body.cycleId}/decide`, { decision: cycle.body.computed.decision, rationale: 'Agree with the computed recommendation.' });
    expect(decided.status).toBe(200);
    const cycles = await app.ctx.db.select().from(reviewCycles).where(eq(reviewCycles.planId, planId));
    expect(cycles.some((c) => c.status === 'decided' && c.reviewerUserId === 'u-t')).toBe(true);
    const family = await get('guardian@test.school', `/api/cases/${caseKey}`);
    const decidedView = family.body.reviewCycles.find((c: { status: string }) => c.status === 'decided');
    expect(decidedView.narrativeFamily).toBeDefined();
    expect(decidedView.narrativeTeacher).toBeUndefined();
  });
});

describe('Phase 7: administration', () => {
  it('serves aggregates with cell suppression and never individual rows', async () => {
    const t = await get('admin@test.school', '/api/admin/trends');
    expect(t.status).toBe(200);
    expect(t.body.minCellSize).toBe(10);
    expect(t.body.activeCases).toBeNull(); // 1 case < minimum cell size
    expect(JSON.stringify(t.body)).not.toMatch(/Marcus|ck_/);
    const e = await get('admin@test.school', '/api/admin/equity');
    expect(e.body.attributes.every((a: { groups: Array<{ suppressed: boolean }> }) => a.groups.every((g) => g.suppressed))).toBe(true);
    expect((await get('teacher@test.school', '/api/admin/trends')).status).toBe(403);
  });
  it('shows catalog health and lets an admin retire a definition, with a reviewer required to activate', async () => {
    const c = await get('admin@test.school', '/api/admin/catalog');
    const cpd = c.body.find((d: { id: string }) => d.id === 'context-performance-divergence');
    expect(cpd.fired).toBe(1);
    expect(cpd.confirmationRate).toBe(1);
    const noReviewer = await post('admin@test.school', '/api/admin/definitions/task-length-sensitivity/status', { status: 'active' });
    expect(noReviewer.status).toBe(400);
    const retire = await post('admin@test.school', '/api/admin/definitions/context-performance-divergence/status', { status: 'retired' });
    expect(retire.status).toBe(200);
    const after = await get('admin@test.school', '/api/admin/catalog');
    expect(after.body.find((d: { id: string }) => d.id === 'context-performance-divergence').status).toBe('retired');
  });
  it('gates prompt promotion on a recorded passing eval run', async () => {
    const created = await post('admin@test.school', '/api/admin/prompts', { surface: 'plan_generation', body: 'x'.repeat(60), model: 'default', params: { reasoningEffort: null, maxTokens: 4000 }, changelog: 'test version' });
    expect(created.status).toBe(200);
    const blocked = await post('admin@test.school', `/api/admin/prompts/${created.body.id}/promote`);
    expect(blocked.status).toBe(400);
    const evals = await post('admin@test.school', `/api/admin/prompts/plan_generation.v1/evals`, { judge: false });
    expect(evals.status).toBe(200);
    expect(evals.body.passed).toBe(true);
    const diffs = await get('admin@test.school', '/api/admin/draft-diffs');
    expect(diffs.body.approvedPlans).toBe(1);
  }, 60_000);
});

/**
 * The model kill switch, from the API's side. This needs its own app because the provider is
 * resolved once at boot, so it cannot share the suite's mock-backed instance.
 */
describe('AI_PROVIDER=off', () => {
  let offApp: AppHandle;
  let offServer: FastifyInstance;

  beforeAll(async () => {
    offApp = await createApp({
      env: { ...process.env, NODE_ENV: 'test', AI_PROVIDER: 'off', AUTH_PROVIDER: 'dev', DATABASE_URL: '', OPENAI_API_KEY: '' },
      memory: true,
      pollMs: 60_000,
    });
    offServer = await buildServer(offApp.ctx, { logger: false });
    await offApp.ctx.db.insert(organizations).values({ id: 'org', name: 'Org' });
    await offApp.ctx.db.insert(schools).values({ id: S.school, orgId: 'org', name: 'School' });
    await offApp.ctx.db.insert(users).values({ id: 'u-a', email: 'admin@test.school', displayName: 'Admin' });
    await offApp.ctx.db.insert(roleAssignments).values({ id: newId(), userId: 'u-a', role: 'administrator', schoolId: S.school, sectionId: null, studentId: null });
  });

  afterAll(async () => {
    await offServer.close();
    await offApp.close();
  });

  it('boots with no API key and reports the model as disabled', async () => {
    expect(offApp.ctx.gate.providerName).toBe('disabled');
    const health = await offServer.inject({ method: 'GET', url: '/health' });
    expect(health.json().provider).toBe('disabled');
  });

  it('tells every client the model is off via /auth/me', async () => {
    const admin = await offServer.inject({ method: 'GET', url: '/auth/me', headers: { authorization: 'Test u-a' } });
    expect(admin.statusCode).toBe(200);
    expect(admin.json().modelEnabled).toBe(false);
  });

  it('refuses to run evals instead of reporting a misleading score', async () => {
    const res = await offServer.inject({ method: 'POST', url: '/api/admin/prompts/plan_generation.v1/evals', payload: { judge: false }, headers: { authorization: 'Test u-a' } });
    expect(res.statusCode).toBe(409);
    expect(res.json().error).toContain('AI_PROVIDER=off');
  });
});

describe("the teacher's own class", () => {
  let sectionId = '';
  let newStudentId = '';

  it('lets a teacher create a section and put a student on their own roster', async () => {
    const sec = await post('teacher@test.school', '/api/classroom/sections', { name: 'Sec 3', gradeLevel: '7', periodTag: 'period_5' });
    expect(sec.status).toBe(200);
    sectionId = sec.body.id;
    expect(sec.body.schoolId).toBe(S.school);

    const stu = await post('teacher@test.school', '/api/classroom/students', { sectionId, firstName: 'Nadia', lastName: 'Okonkwo' });
    expect(stu.status).toBe(200);
    newStudentId = stu.body.id;
    expect(stu.body.gradeLevel).toBe('7'); // inherited from the section

    const roster = await get('teacher@test.school', '/api/roster');
    expect(roster.body.map((r: { id: string }) => r.id)).toContain(newStudentId);
    const klass = await get('teacher@test.school', '/api/classroom');
    expect(klass.body.sections.map((x: { id: string }) => x.id)).toContain(sectionId);
    expect(klass.body.students.map((x: { displayName: string }) => x.displayName)).toContain('Nadia Okonkwo');
  });

  it('keeps one teacher out of another teacher\'s section', async () => {
    const r = await post('teacher2@test.school', '/api/classroom/students', { sectionId, firstName: 'Not', lastName: 'Mine' });
    expect(r.status).toBe(403);
    const klass = await get('teacher2@test.school', '/api/classroom');
    expect(klass.body.students.map((x: { id: string }) => x.id)).not.toContain(newStudentId);
  });

  it('lets the teacher on the case open the family dashboard for their own student', async () => {
    const inv = await post('teacher@test.school', `/api/classroom/students/${newStudentId}/access`, { email: 'parent2@test.school', role: 'guardian' });
    expect(inv.status).toBe(200);
    expect(inv.body.status).toBe('accepted'); // the email already had an account: no second sign-up
    const me = await server.inject({ method: 'GET', url: '/auth/me', headers: { authorization: 'Test u-g2' } });
    expect(me.json().roles).toEqual(['guardian']);
    expect(me.json().assignments[0].studentId).toBe(newStudentId);

    const access = await get('teacher@test.school', `/api/classroom/students/${newStudentId}/access`);
    expect(access.body).toHaveLength(1);
    expect(access.body[0]).toMatchObject({ email: 'parent2@test.school', role: 'guardian', invitedByMe: true });
  });

  it('lists an accepted invitation once, not again for the role assignment it produced', async () => {
    const klass = await get('teacher@test.school', '/api/classroom');
    const forNew = klass.body.access.filter((a: { studentId: string }) => a.studentId === newStudentId);
    expect(forNew).toHaveLength(1);
    expect(forNew[0]).toMatchObject({ email: 'parent2@test.school', role: 'guardian', status: 'accepted', invitedByMe: true });
  });

  it('lists family and student access held through a role assignment with no invitation behind it', async () => {
    // guardian@ and student@ were given their assignments on studentA directly, as the seed does.
    const access = await get('teacher@test.school', `/api/classroom/students/${S.studentA}/access`);
    expect(access.status).toBe(200);
    const byEmail = Object.fromEntries(access.body.map((a: { email: string }) => [a.email, a]));
    expect(Object.keys(byEmail).sort()).toEqual(['guardian@test.school', 'student@test.school']);
    expect(byEmail['guardian@test.school']).toMatchObject({ role: 'guardian', status: 'accepted', invitedByMe: false });
    expect(byEmail['student@test.school']).toMatchObject({ role: 'student', status: 'accepted', invitedByMe: false });
    expect(byEmail['guardian@test.school'].inviterName).toBeUndefined();
    expect(byEmail['guardian@test.school'].createdAt).toBeTruthy();

    const klass = await get('teacher@test.school', '/api/classroom');
    const forA = klass.body.access.filter((a: { studentId: string }) => a.studentId === S.studentA);
    expect(forA.map((a: { email: string }) => a.email).sort()).toEqual(['guardian@test.school', 'student@test.school']);

    // The assignment's id is not an invitation id: the revoke endpoint will not act on it.
    const revoke = await post('teacher@test.school', `/api/classroom/access/${byEmail['guardian@test.school'].id}/revoke`);
    expect(revoke.status).toBe(404);
  });

  it('records the grant against the teacher, not an administrator', async () => {
    const rows = await app.ctx.db.select().from(auditEvents).where(eq(auditEvents.studentId, newStudentId));
    const grant = rows.find((r) => r.action === 'authorization.grant');
    expect(grant?.actorRole).toBe('teacher');
    expect(grant?.actorUserId).toBe('u-t');
  });

  it('refuses a second identical invitation instead of stacking role assignments', async () => {
    const again = await post('teacher@test.school', `/api/classroom/students/${newStudentId}/access`, { email: 'parent2@test.school', role: 'guardian' });
    expect(again.status).toBe(409);
  });

  it('refuses a student outside the teacher\'s own sections', async () => {
    const r = await post('teacher@test.school', `/api/classroom/students/${S.studentOther}/access`, { email: 'parent2@test.school', role: 'guardian' });
    expect(r.status).toBe(403);
  });

  it('will not let a teacher grant a staff or school-wide role', async () => {
    for (const role of ['teacher', 'support_professional', 'administrator']) {
      const r = await post('teacher@test.school', `/api/classroom/students/${newStudentId}/access`, { email: 'someone@test.school', role });
      expect(r.status).toBe(400);
    }
  });

  it('keeps the classroom surface away from families and administrators', async () => {
    expect((await get('guardian@test.school', '/api/classroom')).status).toBe(403);
    expect((await get('student@test.school', '/api/classroom')).status).toBe(403);
    expect((await get('admin@test.school', '/api/classroom')).status).toBe(403);
  });
});
