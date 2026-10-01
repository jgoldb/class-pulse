import { createHash } from 'node:crypto';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { GoalContent, PlanContent, RequestPlanRevision, StrategyContent, diffPlans, newId, summarizeDiffBySection, type PlanRevisionSource } from '@class-pulse/domain';
import { checkEditedPlan } from '@class-pulse/ai';
import type { Actor, AppContext } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import type { Db } from '../db/client';
import { caseLinks, cases, classSections, classroomPlanOrigins, goals, planDrafts, plans, strategies } from '../db/schema';
import { audit } from './audit';
import { learnerProfile } from './profiles';
import { requirePulse, validateClassroomText } from './pulse';

/** Include approved actions added/edited after the original plan was published. */
async function currentPlanContent(db: Db, base: typeof plans.$inferSelect) {
  const content = PlanContent.parse(base.content);
  const currentGoals = await db.select().from(goals).where(and(eq(goals.planId, base.id), eq(goals.status, 'active'))).orderBy(goals.sortOrder, goals.id);
  const currentStrategies = await db.select().from(strategies).where(and(eq(strategies.planId, base.id), eq(strategies.status, 'active'))).orderBy(strategies.sortOrder, strategies.id);
  content.measurableGoals = currentGoals.map((g) => GoalContent.parse(g.content));
  const sections = { preventive: 'preventiveStrategies', response: 'teacherResponseStrategies', self_monitor: 'studentSelfMonitoring', family: 'parentGuardianSupport' } as const;
  for (const [kind, section] of Object.entries(sections)) content[section] = currentStrategies.filter((s) => s.kind === kind).map((s) => StrategyContent.parse(s.content));
  content.replacementBehaviors = currentStrategies.filter((s) => s.kind === 'replacement').map((s) => {
    const strategy = StrategyContent.parse(s.content);
    const original = content.replacementBehaviors.find((r) => r.behavior === strategy.description);
    return { behavior: strategy.description, howToTeach: strategy.rationale, replaces: original?.replaces ?? 'Not recorded; educator review required' };
  });
  return content;
}

async function eligiblePlanSources(ctx: AppContext, actor: Actor, caseKey: string, sources: PlanRevisionSource[]) {
  const [row] = await ctx.db.select({ case: cases, studentId: caseLinks.studentId }).from(cases).innerJoin(caseLinks, eq(caseLinks.caseKey, cases.caseKey)).where(eq(cases.caseKey, caseKey));
  if (!row) throw notFound('Linked case not found');
  await requirePulse(ctx, actor, row.case.sectionId);
  const profile = await learnerProfile(ctx, actor, row.studentId, row.case.sectionId, 'teacher');
  if (!profile.caseKeys.includes(caseKey)) throw forbidden('Case is outside this learner and section');
  const evidence = sources.map((source) => {
    const record = source.kind === 'event' ? profile.history.find((r) => r.id === source.id && r.revision === source.revision) : profile.acceptedContributions.find((r) => r.id === source.id && r.revision === source.revision);
    if (!record) throw conflict('Revision source changed, expired, or is no longer available');
    return { ...source, reportedBy: source.kind === 'event' ? 'teacher' : 'sourceRole' in record ? record.sourceRole : '', content: 'observation' in record ? record.observation : record.content };
  });
  return { sectionId: row.case.sectionId, evidence };
}

export async function planRevisionOrigin(ctx: AppContext, actor: Actor, draftId: string, revalidate = true) {
  const [origin] = await ctx.db.select().from(classroomPlanOrigins).where(eq(classroomPlanOrigins.draftId, draftId));
  if (!origin) return null;
  if (origin.createdBy !== actor.userId) throw forbidden('Classroom revision source history is private to its educator');
  await requirePulse(ctx, actor, origin.sectionId);
  const [draft] = await ctx.db.select().from(planDrafts).where(eq(planDrafts.id, draftId));
  const [base] = await ctx.db.select().from(plans).where(eq(plans.id, origin.basePlanId));
  if (!draft || !base) throw conflict('Revision base unavailable');
  if (revalidate && (origin.invalidatedAt || base.status !== 'active' || origin.createdAt.getTime() <= ctx.now().getTime() - 30 * 86400000)) throw conflict('The source evidence or base plan changed, or the draft expired. Prepare a new revision');
  if (revalidate && (!origin.baseSnapshot || JSON.stringify(PlanContent.parse(origin.baseSnapshot)) !== JSON.stringify(await currentPlanContent(ctx.db, base)))) throw conflict('Approved goals or strategies changed. Prepare a new revision from the current plan');
  const evidence = revalidate ? (await eligiblePlanSources(ctx, actor, draft.caseKey, origin.sources)).evidence : [];
  const baseContent = PlanContent.parse(origin.baseSnapshot ?? base.content);
  return { ...origin, evidence, baseContent, changedSections: draft.content ? summarizeDiffBySection(diffPlans(baseContent, PlanContent.parse(draft.content))) : {} };
}

export async function requestPlanRevision(ctx: AppContext, actor: Actor, input: RequestPlanRevision) {
  const parsed = RequestPlanRevision.parse(input);
  const { sectionId } = await eligiblePlanSources(ctx, actor, parsed.caseKey, parsed.sources);
  await validateClassroomText(ctx.db, sectionId, { description: parsed.description, rationale: parsed.rationale });
  const inputHash = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, sectionId)).for('update');
    await tx.select().from(cases).where(eq(cases.caseKey, parsed.caseKey)).for('update');
    await eligiblePlanSources({ ...ctx, db: tx }, actor, parsed.caseKey, parsed.sources);
    const [existing] = await tx.select().from(classroomPlanOrigins).where(and(eq(classroomPlanOrigins.createdBy, actor.userId), eq(classroomPlanOrigins.requestId, parsed.requestId)));
    if (existing) { if (existing.inputHash !== inputHash) throw conflict('Request ID already used'); return { draftId: existing.draftId }; }
    const [base] = await tx.select().from(plans).where(and(eq(plans.id, parsed.basePlanId), eq(plans.caseKey, parsed.caseKey), eq(plans.status, 'active')));
    if (!base || base.sourceReviewNeeded) throw conflict('Choose the current active plan after reviewing any source corrections');
    const [baseDraft] = await tx.select().from(planDrafts).where(eq(planDrafts.id, base.draftId));
    if (!baseDraft) throw conflict('Base draft unavailable');
    const baseSnapshot = await currentPlanContent(tx, base);
    const content = structuredClone(baseSnapshot);
    content[parsed.strategySection].push({ description: parsed.description, rationale: parsed.rationale, usesStrengths: [], effortLevel: 'low' });
    const guardrails = checkEditedPlan(content);
    if (!guardrails.passed) throw badRequest('Proposed revision fails guardrails', { findings: guardrails.findings });
    const draftId = newId();
    await tx.insert(planDrafts).values({ id: draftId, caseKey: parsed.caseKey, intakeId: baseDraft.intakeId, content, guardrails, status: 'ready', createdBy: actor.userId });
    await tx.insert(classroomPlanOrigins).values({ draftId, basePlanId: base.id, baseSnapshot, sectionId, createdBy: actor.userId, requestId: parsed.requestId, inputHash, sources: parsed.sources });
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'plan.revision', targetType: 'plan_draft', targetId: draftId, caseKey: parsed.caseKey, metadata: { basePlanId: base.id, section: parsed.strategySection, sources: parsed.sources } });
    return { draftId };
  });
}

/** Preserve approved plans for educator review, while blocking stale pending revisions. */
export async function invalidatePlanRevisionSources(db: Db, sectionId: string, kind: PlanRevisionSource['kind'], sourceId: string) {
  const origins = await db.select().from(classroomPlanOrigins).where(eq(classroomPlanOrigins.sectionId, sectionId));
  const ids = origins.filter((o) => o.sources.some((s) => s.kind === kind && s.id === sourceId)).map((o) => o.draftId);
  if (!ids.length) return;
  await db.update(classroomPlanOrigins).set({ invalidatedAt: new Date() }).where(inArray(classroomPlanOrigins.draftId, ids));
  await db.update(plans).set({ sourceReviewNeeded: true, updatedAt: new Date() }).where(inArray(plans.draftId, ids));
}

export async function listClassroomPlanRevisions(ctx: AppContext, actor: Actor) {
  const ids = [...actor.scope.teacherSectionIds];
  if (!ids.length) return [];
  const rows = await ctx.db.select({ draftId: classroomPlanOrigins.draftId, caseKey: planDrafts.caseKey, invalidatedAt: classroomPlanOrigins.invalidatedAt, status: planDrafts.status, sectionId: classroomPlanOrigins.sectionId }).from(classroomPlanOrigins).innerJoin(planDrafts, eq(planDrafts.id, classroomPlanOrigins.draftId)).where(and(eq(classroomPlanOrigins.createdBy, actor.userId), inArray(classroomPlanOrigins.sectionId, ids))).orderBy(desc(classroomPlanOrigins.createdAt));
  const visible = [];
  for (const row of rows) { try { await requirePulse(ctx, actor, row.sectionId); visible.push(row); } catch { /* disabled */ } }
  return visible;
}
