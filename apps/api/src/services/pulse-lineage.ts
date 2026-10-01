import { and, eq, inArray, sql } from 'drizzle-orm';
import type { Db } from '../db/client';
import { classroomDrafts, followUpTasks, patternCandidates, plans, reviewCycles, signalProjections, signals } from '../db/schema';
import { invalidatePlanRevisionSources } from './classroom-plan-revisions';

/** Called in the same section-locked transaction as source corrections/withdrawals. */
export async function invalidateEventArtifacts(db: Db, sectionId: string, eventId: string) {
  await invalidatePlanRevisionSources(db, sectionId, 'event', eventId);
  const projections = await db.select().from(signalProjections).where(eq(signalProjections.eventId, eventId));
  if (projections.length) {
    const ids = projections.map((p) => p.signalId);
    await db.update(signals).set({ retiredAt: new Date() }).where(inArray(signals.id, ids));
    const decided = await db.select({ planId: reviewCycles.planId }).from(reviewCycles).where(and(inArray(reviewCycles.caseKey, projections.map((p) => p.caseKey)), eq(reviewCycles.status, 'decided')));
    if (decided.length) await db.update(plans).set({ sourceReviewNeeded: true, updatedAt: new Date() }).where(inArray(plans.id, decided.map((r) => r.planId)));
    await db.update(reviewCycles).set({ sourceInvalidatedAt: new Date(), evidenceVersion: sql`${reviewCycles.evidenceVersion} + 1`, narrativeStatus: 'stale' }).where(and(inArray(reviewCycles.caseKey, projections.map((p) => p.caseKey)), inArray(reviewCycles.status, ['open', 'decided'])));
    const candidates = await db.select().from(patternCandidates).where(inArray(patternCandidates.caseKey, projections.map((p) => p.caseKey)));
    const stale = candidates.filter((c) => c.evidenceRefs.some((id) => ids.includes(id))).map((c) => c.id);
    if (stale.length) await db.update(patternCandidates).set({ sourceInvalidatedAt: new Date(), visible: false }).where(inArray(patternCandidates.id, stale));
    const affectedPlans = candidates.filter((c) => stale.includes(c.id) && (c.resultingGoalId || c.resultingStrategyId)).map((c) => c.caseKey);
    if (affectedPlans.length) await db.update(plans).set({ sourceReviewNeeded: true, updatedAt: new Date() }).where(and(inArray(plans.caseKey, affectedPlans), inArray(plans.status, ['active', 'under_review'])));
  }
  const drafts = await db.select().from(classroomDrafts).where(eq(classroomDrafts.sectionId, sectionId));
  const affected = drafts.filter((d) => d.sources.some((s) => s.eventId === eventId) && d.reviewState !== 'discarded');
  if (affected.length) await db.update(followUpTasks).set({ status: 'needs_review', updatedAt: new Date() }).where(and(inArray(followUpTasks.draftId, affected.map((d) => d.id)), eq(followUpTasks.status, 'open')));
  for (const published of [false, true]) {
    const ids = affected.filter((d) => (d.publicationState !== 'unpublished') === published).map((d) => d.id);
    if (ids.length) await db.update(classroomDrafts).set({ reviewState: 'stale', publicationState: published ? 'needs_review' : 'unpublished', updatedAt: new Date() }).where(and(eq(classroomDrafts.sectionId, sectionId), inArray(classroomDrafts.id, ids)));
  }
}

/** New confirmed evidence makes an already-prepared activity incomplete for that session. */
export async function invalidateSessionActivities(db: Db, sessionId: string) {
  for (const state of ['unpublished', 'logged', 'needs_review'] as const) {
    await db.update(classroomDrafts).set({ reviewState: 'stale', publicationState: state === 'unpublished' ? 'unpublished' : 'needs_review', updatedAt: new Date() }).where(and(eq(classroomDrafts.sessionId, sessionId), inArray(classroomDrafts.kind, ['do_now', 'reteach', 'small_group']), inArray(classroomDrafts.reviewState, ['suggested', 'approved']), eq(classroomDrafts.publicationState, state)));
  }
}
