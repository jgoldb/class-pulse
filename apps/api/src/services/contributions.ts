import { createHash } from 'node:crypto';
import { and, desc, eq, gt, inArray } from 'drizzle-orm';
import { CorrectContribution, RespondContribution, SubmitContribution, newId, type ContributionContent } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import { classSections, classroomHelpRequests, classroomPlanOrigins, contributionResponses, contributionRevisions, contributions, expiredClassroomRequests, learnerLinks, plans, roleAssignments, users } from '../db/schema';
import { audit } from './audit';
import { learnerFor, requirePulse, validateClassroomText } from './pulse';
import { learnerProfile, profileScope } from './profiles';
import { buildActor } from './scope';
import { invalidatePlanRevisionSources } from './classroom-plan-revisions';
import { rejectExpiredRequest } from './classroom-receipts';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
async function recipientFor(ctx: AppContext, sectionId: string, recipientId: string) {
  const [assignment] = await ctx.db.select({ id: roleAssignments.id }).from(roleAssignments).where(and(eq(roleAssignments.userId, recipientId), eq(roleAssignments.sectionId, sectionId), eq(roleAssignments.role, 'teacher'))).limit(1);
  if (!assignment) throw forbidden('Choose a currently assigned teacher');
}
async function validateContent(ctx: AppContext, actor: Actor, studentId: string, sectionId: string, role: 'student' | 'guardian', content: ContributionContent) {
  const allowed = role === 'student' ? ['reflection', 'proposal', 'strategy_choice'] : ['family_observation', 'home_strategy', 'homework', 'proposal', 'strategy_choice'];
  if (!allowed.includes(content.kind)) throw badRequest('This contribution type is not available for this role');
  const text = Object.fromEntries(Object.entries(content).filter(([k]) => k !== 'strategyId'));
  await validateClassroomText(ctx.db, sectionId, text);
  if (content.kind === 'strategy_choice') {
    const profile = await learnerProfile(ctx, actor, studentId, sectionId, role);
    if (!profile.strategies.some((s) => s.id === content.strategyId)) throw badRequest('Choose a current approved strategy for this learner and section');
  }
}
export async function submitContribution(ctx: AppContext, actor: Actor, input: SubmitContribution) {
  const parsed = SubmitContribution.parse(input);
  const { section } = await profileScope(ctx, actor, parsed.studentId, parsed.sectionId, parsed.role);
  await recipientFor(ctx, parsed.sectionId, parsed.recipientId);
  await validateContent(ctx, actor, parsed.studentId, parsed.sectionId, parsed.role, parsed.content);
  const inputHash = hash(parsed);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, section.id)).for('update');
    await rejectExpiredRequest(tx, 'contribution', actor.userId, parsed.requestId);
    const [existing] = await tx.select().from(contributionRevisions).where(and(eq(contributionRevisions.createdBy, actor.userId), eq(contributionRevisions.requestId, parsed.requestId)));
    if (existing) { if (existing.inputHash !== inputHash) throw conflict('Request ID already used with different content'); return { id: existing.contributionId, revision: existing.revision }; }
    const learnerKey = await learnerFor(tx, actor, section.id, parsed.studentId, parsed.role);
    const id = newId();
    await tx.insert(contributions).values({ id, learnerKey, sectionId: section.id, schoolId: section.schoolId, createdBy: actor.userId, sourceRole: parsed.role, recipientId: parsed.recipientId, expiresAt: new Date(ctx.now().getTime() + 30 * 86400000) });
    await tx.insert(contributionRevisions).values({ id: newId(), contributionId: id, revision: 1, content: parsed.content, createdBy: actor.userId, requestId: parsed.requestId, inputHash });
    await audit(tx, { actorUserId: actor.userId, actorRole: parsed.role, action: 'contribution.submit', targetType: 'contribution', targetId: id, metadata: { revision: 1, sectionId: section.id, recipientId: parsed.recipientId, kind: parsed.content.kind } });
    return { id, revision: 1 };
  });
}

async function contributionFor(ctx: AppContext, actor: Actor, id: string, authorOnly = false) {
  const [item] = await ctx.db.select().from(contributions).where(eq(contributions.id, id));
  if (!item) throw notFound('Contribution not found');
  const [link] = await ctx.db.select().from(learnerLinks).where(eq(learnerLinks.learnerKey, item.learnerKey));
  if (!link) throw forbidden('Learner is no longer available');
  if (item.createdBy === actor.userId) await profileScope(ctx, actor, link.studentId, item.sectionId, item.sourceRole);
  else {
    if (authorOnly || item.recipientId !== actor.userId) throw forbidden('Contribution is private to its author and selected educator');
    await profileScope(ctx, actor, link.studentId, item.sectionId, 'teacher');
  }
  await recipientFor(ctx, item.sectionId, item.recipientId);
  const [authorLink] = await ctx.db.select({ id: roleAssignments.id }).from(roleAssignments).where(and(eq(roleAssignments.userId, item.createdBy), eq(roleAssignments.role, item.sourceRole), eq(roleAssignments.studentId, link.studentId))).limit(1);
  if (!authorLink) throw forbidden('The contributor relationship is no longer active');
  if (item.expiresAt <= ctx.now() || item.status === 'expired') throw conflict('Contribution expired');
  return { item, studentId: link.studentId };
}
export async function listContributions(ctx: AppContext, actor: Actor, sectionId: string, studentId?: string) {
  if (!studentId) await requirePulse(ctx, actor, sectionId);
  const rows = await ctx.db.select({ item: contributions, content: contributionRevisions.content, studentId: learnerLinks.studentId, authorName: users.displayName }).from(contributions)
    .innerJoin(contributionRevisions, and(eq(contributionRevisions.contributionId, contributions.id), eq(contributionRevisions.revision, contributions.revision)))
    .innerJoin(learnerLinks, eq(learnerLinks.learnerKey, contributions.learnerKey)).innerJoin(users, eq(users.id, contributions.createdBy))
    .where(and(eq(contributions.sectionId, sectionId), gt(contributions.expiresAt, ctx.now()), ...(studentId ? [eq(learnerLinks.studentId, studentId)] : [eq(contributions.recipientId, actor.userId)]))).orderBy(desc(contributions.updatedAt));
  const result = [];
  const approvedRevisions = await ctx.db.select({ sources: classroomPlanOrigins.sources, version: plans.version }).from(classroomPlanOrigins).innerJoin(plans, eq(plans.draftId, classroomPlanOrigins.draftId)).where(and(eq(classroomPlanOrigins.sectionId, sectionId), eq(plans.status, 'active'), eq(plans.sourceReviewNeeded, false)));
  for (const row of rows) {
    try { await contributionFor(ctx, actor, row.item.id); }
    catch { continue; }
    const usedInPlanVersion = row.item.status === 'accepted' ? approvedRevisions.find((p) => p.sources.some((s) => s.kind === 'contribution' && s.id === row.item.id && s.revision === row.item.revision))?.version ?? null : null;
    result.push({ id: row.item.id, revision: row.item.revision, studentId: row.studentId, sourceRole: row.item.sourceRole, authorName: row.authorName, own: row.item.createdBy === actor.userId, status: row.item.status, content: row.item.status === 'withdrawn' ? null : row.content, response: row.item.response, respondedAt: row.item.respondedAt, createdAt: row.item.createdAt, expiresAt: row.item.expiresAt, usedInPlanVersion });
  }
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: actor.scope.teacherSectionIds.has(sectionId) ? 'teacher' : actor.roles.has('guardian') ? 'guardian' : 'student', action: 'contribution.read', targetType: 'contribution', metadata: { sectionId, count: result.length } });
  return result;
}
export async function respondContribution(ctx: AppContext, actor: Actor, id: string, input: RespondContribution) {
  const parsed = RespondContribution.parse(input);
  const { item } = await contributionFor(ctx, actor, id);
  if (item.recipientId !== actor.userId) throw forbidden('Only the selected educator can respond');
  await requirePulse(ctx, actor, item.sectionId);
  await validateClassroomText(ctx.db, item.sectionId, parsed.response);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, item.sectionId)).for('update');
    const { item: current, studentId } = await contributionFor({ ...ctx, db: tx }, actor, id);
    if (current.revision !== parsed.expectedRevision) throw conflict('Contribution changed. Review its current wording');
    if (current.status === parsed.decision && current.response === parsed.response) return { ok: true };
    if (!['pending', 'acknowledged'].includes(current.status)) throw conflict('This contribution has already been decided or withdrawn');
    if (parsed.decision === 'accepted') {
      const [author] = await tx.select().from(users).where(eq(users.id, current.createdBy));
      const [revision] = await tx.select().from(contributionRevisions).where(and(eq(contributionRevisions.contributionId, id), eq(contributionRevisions.revision, current.revision)));
      if (!author || !revision) throw conflict('Source unavailable');
      await validateContent({ ...ctx, db: tx }, await buildActor(tx, author), studentId, current.sectionId, current.sourceRole, revision.content);
    }
    await tx.update(contributions).set({ status: parsed.decision, response: parsed.response, respondedAt: ctx.now(), updatedAt: ctx.now(), ...(parsed.decision === 'accepted' ? { expiresAt: new Date(ctx.now().getTime() + 120 * 86400000) } : {}) }).where(eq(contributions.id, id));
    await tx.insert(contributionResponses).values({ id: newId(), contributionId: id, revision: parsed.expectedRevision, decision: parsed.decision, response: parsed.response, createdBy: actor.userId });
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'contribution.respond', targetType: 'contribution', targetId: id, metadata: { revision: parsed.expectedRevision, decision: parsed.decision } });
    return { ok: true };
  });
}
export async function correctContribution(ctx: AppContext, actor: Actor, id: string, input: CorrectContribution) {
  const parsed = CorrectContribution.parse(input);
  const { item, studentId } = await contributionFor(ctx, actor, id, true);
  await validateContent(ctx, actor, studentId, item.sectionId, item.sourceRole, parsed.content);
  const inputHash = hash({ id, ...parsed });
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, item.sectionId)).for('update');
    const [retry] = await tx.select().from(contributionRevisions).where(and(eq(contributionRevisions.createdBy, actor.userId), eq(contributionRevisions.requestId, parsed.requestId)));
    await rejectExpiredRequest(tx, 'contribution', actor.userId, parsed.requestId);
    if (retry) { if (retry.inputHash !== inputHash) throw conflict('Request ID already used with different content'); return { id, revision: retry.revision }; }
    const { item: current } = await contributionFor({ ...ctx, db: tx }, actor, id, true);
    if (current.revision !== parsed.expectedRevision || current.status === 'withdrawn') throw conflict('Contribution changed or was withdrawn');
    const revision = current.revision + 1;
    await invalidatePlanRevisionSources(tx, item.sectionId, 'contribution', id);
    await tx.insert(contributionRevisions).values({ id: newId(), contributionId: id, revision, content: parsed.content, createdBy: actor.userId, requestId: parsed.requestId, inputHash });
    await tx.update(contributions).set({ revision, status: 'pending', response: null, respondedAt: null, updatedAt: ctx.now(), expiresAt: new Date(ctx.now().getTime() + 30 * 86400000) }).where(eq(contributions.id, id));
    await audit(tx, { actorUserId: actor.userId, actorRole: item.sourceRole, action: 'contribution.correct', targetType: 'contribution', targetId: id, metadata: { revision, previousRevision: current.revision } });
    return { id, revision };
  });
}
export async function withdrawContribution(ctx: AppContext, actor: Actor, id: string, expectedRevision: number) {
  const { item } = await contributionFor(ctx, actor, id, true);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, item.sectionId)).for('update');
    const { item: current } = await contributionFor({ ...ctx, db: tx }, actor, id, true);
    if (current.revision !== expectedRevision) throw conflict('Contribution changed');
    if (current.status === 'withdrawn') return { ok: true };
    await invalidatePlanRevisionSources(tx, item.sectionId, 'contribution', id);
    await tx.update(contributions).set({ status: 'withdrawn', response: null, updatedAt: ctx.now(), expiresAt: new Date(ctx.now().getTime() + 30 * 86400000) }).where(eq(contributions.id, id));
    await audit(tx, { actorUserId: actor.userId, actorRole: item.sourceRole, action: 'contribution.withdraw', targetType: 'contribution', targetId: id, metadata: { revision: expectedRevision } });
    return { ok: true };
  });
}

export async function requestClassroomHelp(ctx: AppContext, actor: Actor, input: { requestId: string; studentId: string; sectionId: string; recipientId: string; role: 'student' | 'guardian'; description: string }) {
  const { section } = await profileScope(ctx, actor, input.studentId, input.sectionId, input.role);
  await recipientFor(ctx, section.id, input.recipientId);
  // Safety routing is immediate and does not depend on ordinary review or AI availability.
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, section.id)).for('update');
    const inputHash = hash(input);
    const [existing] = await tx.select().from(classroomHelpRequests).where(and(eq(classroomHelpRequests.createdBy, actor.userId), eq(classroomHelpRequests.requestId, input.requestId)));
    if (existing) { if (existing.inputHash !== inputHash) throw conflict('Request ID already used'); return { id: existing.id }; }
    const learnerKey = await learnerFor(tx, actor, section.id, input.studentId, input.role);
    const id = newId();
    await tx.insert(classroomHelpRequests).values({ id, requestId: input.requestId, inputHash, learnerKey, sectionId: section.id, schoolId: section.schoolId, createdBy: actor.userId, recipientId: input.recipientId, description: input.description });
    await audit(tx, { actorUserId: actor.userId, actorRole: input.role, action: 'classroom.help', targetType: 'help_request', targetId: id, metadata: { sectionId: section.id, recipientId: input.recipientId } });
    return { id };
  });
}
export async function listClassroomHelp(ctx: AppContext, actor: Actor, sectionId: string) {
  await requirePulse(ctx, actor, sectionId);
  const rows = await ctx.db.select({ request: classroomHelpRequests, studentId: learnerLinks.studentId }).from(classroomHelpRequests).innerJoin(learnerLinks, eq(learnerLinks.learnerKey, classroomHelpRequests.learnerKey)).where(and(eq(classroomHelpRequests.sectionId, sectionId), eq(classroomHelpRequests.recipientId, actor.userId))).orderBy(desc(classroomHelpRequests.createdAt));
  const result = [];
  for (const row of rows) {
    try { await profileScope(ctx, actor, row.studentId, sectionId, 'teacher'); } catch { continue; }
    result.push({ id: row.request.id, studentId: row.studentId, description: row.request.description, status: row.request.status, createdAt: row.request.createdAt });
  }
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'classroom.help', targetType: 'help_request', metadata: { sectionId, readCount: result.length } });
  return result;
}
export async function acknowledgeClassroomHelp(ctx: AppContext, actor: Actor, id: string) {
  const [item] = await ctx.db.select().from(classroomHelpRequests).where(eq(classroomHelpRequests.id, id));
  if (!item || item.recipientId !== actor.userId) throw forbidden('Help request is outside your assignment');
  await requirePulse(ctx, actor, item.sectionId);
  const [link] = await ctx.db.select().from(learnerLinks).where(eq(learnerLinks.learnerKey, item.learnerKey));
  if (!link) throw forbidden('Learner unavailable');
  await profileScope(ctx, actor, link.studentId, item.sectionId, 'teacher');
  await ctx.db.update(classroomHelpRequests).set({ status: 'acknowledged', acknowledgedAt: ctx.now() }).where(and(eq(classroomHelpRequests.id, id), eq(classroomHelpRequests.status, 'open')));
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'classroom.help', targetType: 'help_request', targetId: id, metadata: { acknowledged: true } });
  return { ok: true };
}

export async function expireContributions(ctx: AppContext) {
  const rows = await ctx.db.select().from(contributions).where(inArray(contributions.status, ['pending', 'acknowledged', 'accepted', 'declined', 'withdrawn']));
  for (const row of rows.filter((r) => r.expiresAt <= ctx.now())) await ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, row.sectionId)).for('update');
    const [current] = await tx.select().from(contributions).where(eq(contributions.id, row.id));
    if (!current || current.expiresAt > ctx.now() || current.status === 'expired') return;
    await invalidatePlanRevisionSources(tx, current.sectionId, 'contribution', current.id);
    const erased = await tx.select().from(contributionRevisions).where(eq(contributionRevisions.contributionId, row.id));
    if (erased.length) await tx.insert(expiredClassroomRequests).values(erased.map((r) => ({ id: newId(), kind: 'contribution' as const, createdBy: r.createdBy, requestId: r.requestId }))).onConflictDoNothing();
    await tx.delete(contributionRevisions).where(eq(contributionRevisions.contributionId, row.id));
    await tx.delete(contributionResponses).where(eq(contributionResponses.contributionId, row.id));
    await tx.update(contributions).set({ status: 'expired', response: null, updatedAt: ctx.now() }).where(eq(contributions.id, row.id));
    await audit(tx, { actorUserId: null, actorRole: null, action: 'contribution.expire', targetType: 'contribution', targetId: row.id, metadata: { revision: row.revision } });
  });
}
