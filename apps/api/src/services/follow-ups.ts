import { createHash } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { CreateFollowUp, UpdateFollowUp, newId, schoolClock } from '@class-pulse/domain';
import { canReadClassroomRecord } from '@class-pulse/policy';
import type { AppContext, Actor } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import { classSections, followUpTasks, schools } from '../db/schema';
import { readArtifact } from './artifacts';
import { requirePulse, validateClassroomText } from './pulse';
import { audit } from './audit';

export async function createFollowUp(ctx: AppContext, actor: Actor, input: CreateFollowUp) {
  const parsed = CreateFollowUp.parse(input);
  const { draft } = await readArtifact(ctx, actor, parsed.draftId);
  await validateClassroomText(ctx.db, draft.sectionId, { title: parsed.title, action: parsed.action });
  const inputHash = createHash('sha256').update(JSON.stringify(parsed)).digest('hex');
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, draft.sectionId)).for('update');
    // Recheck access and source eligibility under the correction/publication lock.
    const current = await readArtifact({ ...ctx, db: tx }, actor, parsed.draftId);
    if (current.draft.revision !== parsed.artifactRevision || current.draft.reviewState !== 'approved' || current.draft.publicationState !== 'logged') throw conflict('Review and approve the current source artifact before creating a follow-up');
    const [existing] = await tx.select().from(followUpTasks).where(and(eq(followUpTasks.createdBy, actor.userId), eq(followUpTasks.requestId, parsed.requestId)));
    if (existing) { if (existing.inputHash !== inputHash) throw conflict('Request ID already used with different content'); return existing; }
    const [task] = await tx.insert(followUpTasks).values({ id: newId(), requestId: parsed.requestId, inputHash, draftId: draft.id, artifactRevision: parsed.artifactRevision, sectionId: draft.sectionId, schoolId: draft.schoolId, createdBy: actor.userId, ownerId: actor.userId, kind: parsed.kind, title: parsed.title, action: parsed.action, dueDate: parsed.dueDate, approvedAt: ctx.now() }).returning();
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'follow_up.approve', targetType: 'follow_up', targetId: task!.id, metadata: { revision: 1, draftId: draft.id, artifactRevision: parsed.artifactRevision } });
    return task!;
  });
}

export async function listFollowUps(ctx: AppContext, actor: Actor) {
  const sections = [...actor.scope.teacherSectionIds];
  if (!sections.length) return [];
  const rows = await ctx.db.select({ task: followUpTasks, timezone: schools.timezone }).from(followUpTasks).innerJoin(schools, eq(schools.id, followUpTasks.schoolId)).where(and(eq(followUpTasks.createdBy, actor.userId), inArray(followUpTasks.sectionId, sections))).orderBy(asc(followUpTasks.dueDate));
  const visible = [];
  for (const { task, timezone } of rows) {
    try {
      await requirePulse(ctx, actor, task.sectionId);
      const { draft } = await readArtifact(ctx, actor, task.draftId);
      const changed = draft.revision !== task.artifactRevision || draft.reviewState !== 'approved' || draft.publicationState !== 'logged';
      visible.push({ ...task, ...(changed ? { title: 'Source changed — review required', action: '', status: task.status === 'open' ? 'needs_review' as const : task.status } : {}), sourceChanged: changed, due: !changed && task.status === 'open' && task.dueDate <= schoolClock(ctx.now(), timezone).date });
    } catch { /* Revoked membership or expired sources must not leak task content. */ }
  }
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'follow_up.read', targetType: 'follow_up', metadata: { count: visible.length } });
  return visible;
}

export async function updateFollowUp(ctx: AppContext, actor: Actor, id: string, input: UpdateFollowUp) {
  const parsed = UpdateFollowUp.parse(input);
  const [task] = await ctx.db.select().from(followUpTasks).where(eq(followUpTasks.id, id));
  if (!task) throw notFound('Follow-up not found');
  if (!canReadClassroomRecord(actor.scope, actor.userId, task)) throw forbidden('Follow-up is outside your scope');
  await requirePulse(ctx, actor, task.sectionId);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, task.sectionId)).for('update');
    const [current] = await tx.select().from(followUpTasks).where(eq(followUpTasks.id, id)).for('update');
    if (current!.revision !== parsed.expectedRevision) {
      if (current!.revision === parsed.expectedRevision + 1 && current!.status === parsed.status) return current!;
      throw conflict('Follow-up changed. Reload before updating');
    }
    if (!['open', 'needs_review'].includes(current!.status)) throw badRequest('Follow-up already closed');
    if (parsed.status === 'completed') {
      const { draft } = await readArtifact({ ...ctx, db: tx }, actor, task.draftId);
      if (current!.status === 'needs_review' || draft.revision !== task.artifactRevision || draft.reviewState !== 'approved' || draft.publicationState !== 'logged') throw conflict('Source changed. Cancel this follow-up and approve a replacement');
    }
    const [updated] = await tx.update(followUpTasks).set({ status: parsed.status, revision: parsed.expectedRevision + 1, completedAt: parsed.status === 'completed' ? ctx.now() : null, updatedAt: ctx.now() }).where(eq(followUpTasks.id, id)).returning();
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'follow_up.update', targetType: 'follow_up', targetId: id, metadata: { revision: updated!.revision, status: parsed.status } });
    return updated!;
  });
}
