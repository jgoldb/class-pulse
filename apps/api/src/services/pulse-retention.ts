import { and, eq, inArray, isNull, lt } from 'drizzle-orm';
import { newId } from '@class-pulse/domain';
import type { AppContext } from '../context';
import { artifactPublications, artifactRevisions, classSections, classroomDrafts, classroomEgressPayloads, classroomEvents, classroomPlanOrigins, eventRevisions, expiredClassroomRequests, generationRuns, planDrafts } from '../db/schema';
import { audit } from './audit';

/** Synthetic defaults only. Keep publication/audit lineage; erase expired unapproved text. */
export async function expirePendingClassroomContent(ctx: AppContext) {
  await ctx.db.delete(classroomEgressPayloads).where(lt(classroomEgressPayloads.expiresAt, ctx.now()));
  const cutoff = new Date(ctx.now().getTime() - 30 * 86400000);
  const expired = await ctx.db.select({ eventId: eventRevisions.eventId }).from(eventRevisions).where(and(isNull(eventRevisions.confirmedAt), lt(eventRevisions.createdAt, cutoff)));
  const pending = expired.length ? await ctx.db.select().from(classroomEvents).where(inArray(classroomEvents.id, [...new Set(expired.map((r) => r.eventId))])) : [];
  let eventsExpired = 0, draftsExpired = 0;
  for (const event of pending) await ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, event.sectionId)).for('update');
    const [current] = await tx.select().from(classroomEvents).where(eq(classroomEvents.id, event.id)).for('update');
    const erased = await tx.select().from(eventRevisions).where(and(eq(eventRevisions.eventId, event.id), isNull(eventRevisions.confirmedAt), lt(eventRevisions.createdAt, cutoff)));
    if (!erased.length) return;
    if (erased.some((r) => r.revision === current!.revision)) await tx.update(classroomEvents).set({ status: 'withdrawn' }).where(eq(classroomEvents.id, event.id));
    if (erased.length) await tx.insert(expiredClassroomRequests).values(erased.map((r) => ({ id: newId(), kind: 'event' as const, createdBy: r.createdBy, requestId: r.requestId }))).onConflictDoNothing();
    await tx.delete(eventRevisions).where(inArray(eventRevisions.id, erased.map((r) => r.id)));
    await audit(tx, { actorUserId: null, actorRole: null, action: 'classroom.expire', targetType: 'classroom_event', targetId: event.id, metadata: { revision: current!.revision } });
    eventsExpired++;
  });
  const drafts = await ctx.db.select().from(classroomDrafts).where(lt(classroomDrafts.expiresAt, ctx.now()));
  for (const draft of drafts) await ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, draft.sectionId)).for('update');
    const [current] = await tx.select().from(classroomDrafts).where(eq(classroomDrafts.id, draft.id)).for('update');
    const publications = await tx.select().from(artifactPublications).where(eq(artifactPublications.draftId, draft.id));
    const revisions = await tx.select().from(artifactRevisions).where(eq(artifactRevisions.draftId, draft.id));
    const erased = revisions.filter((r) => !publications.some((p) => p.revision === r.revision));
    if (!erased.length && (current!.publicationState !== 'unpublished' || !current!.sources.length || current!.reviewState === 'discarded')) return;
    if (erased.length) await tx.delete(artifactRevisions).where(inArray(artifactRevisions.id, erased.map((r) => r.id)));
    if (current!.runIds.length) {
      await tx.delete(classroomEgressPayloads).where(inArray(classroomEgressPayloads.runId, current!.runIds));
      await tx.update(generationRuns).set({ error: null }).where(inArray(generationRuns.id, current!.runIds));
    }
    // Preserve approved content and its source lineage. Never silently republish an older version.
    if (current!.publicationState === 'unpublished') await tx.update(classroomDrafts).set({ reviewState: 'discarded', ...(!publications.length ? { sources: [] } : {}), generationKey: `expired:${draft.id}`, error: 'Expired unapproved draft content removed', updatedAt: ctx.now() }).where(eq(classroomDrafts.id, draft.id));
    await audit(tx, { actorUserId: null, actorRole: null, action: 'classroom.expire', targetType: 'classroom_draft', targetId: draft.id, metadata: { revision: current!.revision } });
    draftsExpired++;
  });
  const origins = await ctx.db.select().from(classroomPlanOrigins).where(lt(classroomPlanOrigins.createdAt, cutoff));
  for (const origin of origins) await ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, origin.sectionId)).for('update');
    const [draft] = await tx.select().from(planDrafts).where(eq(planDrafts.id, origin.draftId)).for('update');
    if (!draft || draft.status === 'approved' || !draft.content) return;
    await tx.update(planDrafts).set({ content: null, guardrails: null, piiSpans: null, error: null, status: 'discarded', updatedAt: ctx.now() }).where(eq(planDrafts.id, origin.draftId));
    await tx.update(classroomPlanOrigins).set({ invalidatedAt: ctx.now(), baseSnapshot: null }).where(eq(classroomPlanOrigins.draftId, origin.draftId));
    await audit(tx, { actorUserId: null, actorRole: null, action: 'classroom.expire', targetType: 'plan_draft', targetId: origin.draftId });
  });
  return { eventsExpired, draftsExpired };
}
