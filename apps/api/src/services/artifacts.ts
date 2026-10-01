import { createHash } from 'node:crypto';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { ArtifactContent, RequestArtifact, newId, type ArtifactKind, type ArtifactPayload, type ArtifactSource } from '@class-pulse/domain';
import { checkClassroomArtifact, generateClassroomArtifact } from '@class-pulse/ai';
import { canReadClassroomRecord } from '@class-pulse/policy';
import type { Actor, AppContext } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import type { Db } from '../db/client';
import { artifactPublications, artifactRevisions, artifactShares, classSections, classSessions, classroomDrafts, classroomEvents, eventRevisions, jobs, learnerLinks, sectionEnrollments, students, users } from '../db/schema';
import { audit } from './audit';
import { requirePulse, sessionFor, validateClassroomText } from './pulse';
import { activePrompt } from './prompts';
import { recordRuns } from './ai';
import { buildActor } from './scope';
import { TEMPLATE_KINDS, templateValidation } from './report-templates';
import { daysAgo, daysAhead, retentionFor } from './learner-records';

type Draft = typeof classroomDrafts.$inferSelect;
/** Kinds that summarise a learner's history rather than one lesson may cite any session of the same class. */
const HISTORY_KINDS: ArtifactKind[] = ['guide_explain', 'guide_adjust', 'guide_next_step', 'support_recommendation', 'sst_report', 'mtss_report', 'fba_observations'];
async function eligibleEvidence(db: Db, ctx: AppContext, actor: Actor, sessionId: string, sources: ArtifactSource[], kind?: ArtifactKind) {
  const [anchor] = await db.select({ sectionId: classSessions.sectionId }).from(classSessions).where(eq(classSessions.id, sessionId));
  const evidence = [];
  const subjects = new Set<string>();
  for (const [index, source] of sources.entries()) {
    const [e] = await db.select({ event: classroomEvents, revision: eventRevisions, studentId: learnerLinks.studentId }).from(classroomEvents)
      .innerJoin(eventRevisions, and(eq(classroomEvents.id, eventRevisions.eventId), eq(classroomEvents.revision, eventRevisions.revision)))
      .innerJoin(learnerLinks, eq(learnerLinks.learnerKey, eventRevisions.learnerKey))
      .innerJoin(sectionEnrollments, and(eq(sectionEnrollments.studentId, learnerLinks.studentId), eq(sectionEnrollments.sectionId, classroomEvents.sectionId)))
      .innerJoin(students, and(eq(students.id, learnerLinks.studentId), eq(students.schoolId, classroomEvents.schoolId)))
      .where(and(eq(classroomEvents.id, source.eventId), eq(students.synthetic, true)));
    if (!e || !canReadClassroomRecord(actor.scope, actor.userId, e.event) || (kind && HISTORY_KINDS.includes(kind) ? e.event.sectionId !== anchor?.sectionId : e.event.sessionId !== sessionId) || e.event.revision !== source.revision || e.event.status !== 'confirmed' || !e.revision.confirmedAt || e.revision.observedAt < daysAgo(ctx.now(), (await retentionFor(db, e.event.schoolId)).memoryDays)) throw conflict('Source evidence changed, expired, or is no longer available. Prepare a new draft.');
    subjects.add(e.revision.learnerKey);
    evidence.push({ number: index + 1, observation: e.revision.observation });
  }
  return { evidence, subjects };
}
async function payloadFor(db: Db, ctx: AppContext, actor: Actor, draft: Pick<Draft, 'sessionId' | 'sources' | 'kind'>): Promise<ArtifactPayload> {
  const [session] = await db.select().from(classSessions).where(eq(classSessions.id, draft.sessionId));
  if (!session) throw notFound('Session not found');
  const { evidence, subjects } = await eligibleEvidence(db, ctx, actor, draft.sessionId, draft.sources, draft.kind);
  if (['abc', 'positive_note', 'parent_message', 'sst_report', 'mtss_report', 'fba_observations', 'support_recommendation'].includes(draft.kind) && subjects.size !== 1) throw badRequest('This artifact must concern exactly one student');
  if (draft.kind === 'abc' && (evidence.length !== 1 || evidence[0]!.observation.kind !== 'behavior')) throw badRequest('Choose one behavior observation for an ABC draft');
  if (draft.kind === 'positive_note' && evidence.some((e) => !['praise', 'participation'].includes(e.observation.kind))) throw badRequest('Choose praise or participation for a positive note');
  if (draft.kind === 'fba_observations' && evidence.some((e) => e.observation.kind !== 'behavior')) throw badRequest('Choose behavior observations for an FBA-support evidence packet');
  if (draft.kind === 'small_group') {
    const concepts = new Set(evidence.map(({ observation: o }) => 'concept' in o ? o.concept.trim().toLowerCase() : ''));
    if (subjects.size < 2 || subjects.size > 8 || concepts.size !== 1 || concepts.has('') || evidence.some(({ observation: o }) => !((o.kind === 'understanding' && o.evidence !== 'not_checked') || (o.kind === 'exit_ticket' && o.assessment !== 'not_assessed')))) throw badRequest('Select reviewed understanding or exit-ticket evidence on one concept for 2–8 students');
  }
  return { kind: draft.kind, topic: session.topic, objective: session.objective, evidence };
}
export async function draftFor(ctx: AppContext, actor: Actor, id: string) {
  const [draft] = await ctx.db.select().from(classroomDrafts).where(eq(classroomDrafts.id, id));
  if (!draft) throw notFound('Draft not found');
  if (!canReadClassroomRecord(actor.scope, actor.userId, draft)) throw forbidden('Draft is outside your scope');
  await requirePulse(ctx, actor, draft.sectionId);
  return draft;
}
export async function requestArtifact(ctx: AppContext, actor: Actor, input: RequestArtifact) {
  const parsed = RequestArtifact.parse(input);
  const session = await sessionFor(ctx, actor, parsed.sessionId);
  const sources = [...parsed.sources].sort((a, b) => a.eventId.localeCompare(b.eventId));
  const generationKey = createHash('sha256').update(JSON.stringify({ actor: actor.userId, ...parsed, sources })).digest('hex');
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, session.sectionId)).for('update');
    await payloadFor(tx, ctx, actor, { ...parsed, sources });
    const [existing] = await tx.select().from(classroomDrafts).where(eq(classroomDrafts.generationKey, generationKey));
    if (existing) return { id: existing.id };
    const id = newId();
    const generationState = ctx.aiConfig.provider === 'off' ? 'disabled' : 'queued';
    await tx.insert(classroomDrafts).values({ id, sessionId: session.id, sectionId: session.sectionId, schoolId: session.schoolId, kind: parsed.kind, sources, generationKey, createdBy: actor.userId, generationState, expiresAt: daysAhead(ctx.now(), (await retentionFor(tx, session.schoolId)).pendingDays) });
    if (generationState === 'queued') await tx.insert(jobs).values({ id: `generate_classroom:${id}:0`, type: 'generate_classroom', payload: { draftId: id } }).onConflictDoNothing();
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'artifact.request', targetType: 'classroom_draft', targetId: id, metadata: { kind: parsed.kind, sourceCount: sources.length } });
    return { id };
  });
}
export async function listArtifacts(ctx: AppContext, actor: Actor) {
  const sections = [...actor.scope.teacherSectionIds];
  if (!sections.length) return [];
  const rows = await ctx.db.select().from(classroomDrafts).where(and(eq(classroomDrafts.createdBy, actor.userId), inArray(classroomDrafts.sectionId, sections))).orderBy(desc(classroomDrafts.createdAt));
  const visible = [];
  for (const row of rows) {
    try { await requirePulse(ctx, actor, row.sectionId); } catch { continue; }
    try { await payloadFor(ctx.db, ctx, actor, row); }
    catch {
      // A stale item can expose only non-identifying status, never its former evidence/content.
      if (row.reviewState === 'stale') visible.push({ ...row, sources: [], error: 'Source evidence changed. Prepare from current classroom observations.' });
      continue;
    }
    if (row.expiresAt <= ctx.now() && row.publicationState === 'unpublished') continue;
    visible.push(row);
  }
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'artifact.read', targetType: 'classroom_draft', metadata: { count: visible.length } });
  return inboxContext(ctx, actor, visible);
}

/**
 * What the inbox shows beside each draft: who it concerns, what kind of observations it came
 * from, the class session, the current version's title and the approved audience. Only rows that
 * passed the eligibility check above carry sources, so stale rows stay content-free.
 */
async function inboxContext<T extends Pick<Draft, 'id' | 'sessionId' | 'sources' | 'revision' | 'reviewState'>>(ctx: AppContext, actor: Actor, rows: T[]) {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const eventIds = [...new Set(rows.flatMap((r) => r.sources.map((s) => s.eventId)))];
  const [revisions, publications, sessions, sourceRows] = await Promise.all([
    ctx.db.select({ draftId: artifactRevisions.draftId, revision: artifactRevisions.revision, content: artifactRevisions.content }).from(artifactRevisions).where(inArray(artifactRevisions.draftId, ids)),
    ctx.db.select({ draftId: artifactPublications.draftId, revision: artifactPublications.revision, audience: artifactPublications.audience, approvedAt: artifactPublications.approvedAt }).from(artifactPublications).where(inArray(artifactPublications.draftId, ids)),
    ctx.db.select({ id: classSessions.id, date: classSessions.date, topic: classSessions.topic }).from(classSessions).where(inArray(classSessions.id, [...new Set(rows.map((r) => r.sessionId))])),
    eventIds.length
      ? ctx.db.select({ eventId: eventRevisions.eventId, revision: eventRevisions.revision, kind: sql<string>`${eventRevisions.observation}->>'kind'`, studentId: students.id, firstName: students.firstName, lastName: students.lastName }).from(eventRevisions)
          .innerJoin(learnerLinks, eq(learnerLinks.learnerKey, eventRevisions.learnerKey)).innerJoin(students, eq(students.id, learnerLinks.studentId))
          .where(inArray(eventRevisions.eventId, eventIds))
      : Promise.resolve([]),
  ]);
  if (sourceRows.length) await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'plane.join', targetType: 'classroom_draft', metadata: { purpose: 'draft_inbox', sourceCount: sourceRows.length } });
  return rows.map((row) => {
    const sources = row.sources.flatMap((s) => sourceRows.filter((e) => e.eventId === s.eventId && e.revision === s.revision));
    // A stale draft's former content stays hidden, title included.
    const content = row.reviewState === 'stale' ? undefined : revisions.find((r) => r.draftId === row.id && r.revision === row.revision)?.content as { title?: unknown } | undefined;
    const session = sessions.find((s) => s.id === row.sessionId);
    const publication = publications.find((p) => p.draftId === row.id && p.revision === row.revision);
    return {
      ...row,
      title: typeof content?.title === 'string' ? content.title : null,
      students: [...new Map(sources.map((s) => [s.studentId, { id: s.studentId, displayName: `${s.firstName} ${s.lastName}` }])).values()],
      evidenceKinds: [...new Set(sources.map((s) => s.kind))],
      session: session ? { date: session.date, topic: session.topic } : null,
      approvedAudience: publication?.audience ?? null,
      approvedAt: publication?.approvedAt ?? null,
    };
  });
}
export async function readArtifact(ctx: AppContext, actor: Actor, id: string, auditReads = true) {
  const draft = await draftFor(ctx, actor, id);
  if (draft.reviewState === 'stale') {
    if (auditReads) await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'artifact.read', targetType: 'classroom_draft', targetId: id, metadata: { stale: true } });
    return { draft: { ...draft, sources: [], error: 'Source evidence changed. Prepare a new draft from current observations.' }, revisions: [], publications: [], evidence: [] };
  }
  // Do not return withdrawn source content or content whose student's enrollment was revoked.
  await payloadFor(ctx.db, ctx, actor, draft);
  if (draft.expiresAt <= ctx.now() && draft.publicationState === 'unpublished') throw conflict('Draft expired');
  const revisions = await ctx.db.select().from(artifactRevisions).where(eq(artifactRevisions.draftId, id)).orderBy(artifactRevisions.revision);
  const publications = await ctx.db.select().from(artifactPublications).where(eq(artifactPublications.draftId, id));
  const shares = publications.length ? await ctx.db.select().from(artifactShares).where(inArray(artifactShares.publicationId, publications.map((p) => p.id))) : [];
  if (auditReads) await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'artifact.read', targetType: 'classroom_draft', targetId: id });
  const sourceContext = [];
  for (const [index, source] of draft.sources.entries()) {
    const [row] = await ctx.db.select({ studentId: students.id, firstName: students.firstName, lastName: students.lastName, observedAt: eventRevisions.observedAt, source: eventRevisions.source, confirmedBy: eventRevisions.confirmedBy }).from(eventRevisions)
      .innerJoin(learnerLinks, eq(learnerLinks.learnerKey, eventRevisions.learnerKey)).innerJoin(students, eq(students.id, learnerLinks.studentId))
      .where(and(eq(eventRevisions.eventId, source.eventId), eq(eventRevisions.revision, source.revision)));
    if (row) sourceContext.push({ number: index + 1, ...row });
  }
  const approverIds = [...new Set(publications.map((p) => p.approvedBy))];
  const approvers = approverIds.length ? await ctx.db.select({ id: users.id, displayName: users.displayName }).from(users).where(inArray(users.id, approverIds)) : [];
  if (auditReads) await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'plane.join', targetType: 'classroom_draft', targetId: id, metadata: { sourceCount: sourceContext.length } });
  const template = (TEMPLATE_KINDS as readonly string[]).includes(draft.kind) ? { validation: await templateValidation(ctx.db, draft.schoolId, draft.kind) } : null;
  return { draft, revisions, publications: publications.map((p) => ({ ...p, portalShared: shares.some((s) => s.publicationId === p.id && !s.revokedAt), approverName: approvers.find((u) => u.id === p.approvedBy)?.displayName ?? 'Educator' })), evidence: (await payloadFor(ctx.db, ctx, actor, draft)).evidence, sourceContext, template };
}
export async function retryArtifact(ctx: AppContext, actor: Actor, id: string) {
  const draft = await draftFor(ctx, actor, id);
  if (ctx.aiConfig.provider === 'off') throw conflict('AI is disabled; observations are still saved');
  await ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, draft.sectionId)).for('update');
    const [current] = await tx.select().from(classroomDrafts).where(eq(classroomDrafts.id, id)).for('update');
    if (!['failed', 'disabled'].includes(current!.generationState) || current!.reviewState !== 'suggested' || current!.expiresAt <= ctx.now()) throw conflict('Draft cannot be retried in its current state');
    await payloadFor(tx, ctx, actor, current!);
    await tx.update(classroomDrafts).set({ generationState: 'queued', error: null, updatedAt: ctx.now() }).where(eq(classroomDrafts.id, id));
    await tx.insert(jobs).values({ id: newId(), type: 'generate_classroom', payload: { draftId: id } });
  });
  return { ok: true };
}

export async function runClassroomGeneration(ctx: AppContext, id: string) {
  const [draft] = await ctx.db.select().from(classroomDrafts).where(eq(classroomDrafts.id, id));
  if (!draft || !['queued', 'running'].includes(draft.generationState) || draft.reviewState !== 'suggested' || draft.expiresAt <= ctx.now()) return;
  const [user] = await ctx.db.select().from(users).where(eq(users.id, draft.createdBy));
  if (!user) return;
  try {
    const actor = await buildActor(ctx.db, user);
    await requirePulse(ctx, actor, draft.sectionId);
    const payload = await payloadFor(ctx.db, ctx, actor, draft);
    const prompt = await activePrompt(ctx.db, 'classroom_draft');
    const classifier = await activePrompt(ctx.db, 'guardrail_classifier');
    await ctx.db.update(classroomDrafts).set({ generationState: 'running', promptVersionId: prompt.id, updatedAt: ctx.now() }).where(eq(classroomDrafts.id, id));
    const roster = await ctx.db.select({ first: students.firstName, last: students.lastName }).from(students).where(eq(students.schoolId, draft.schoolId));
    const result = await generateClassroomArtifact(ctx.gate, prompt, classifier, payload, roster.flatMap((s) => [s.first, s.last, `${s.first} ${s.last}`]));
    await recordRuns(ctx.db, 'classroom_draft', null, result.runs, result.ok ? 'succeeded' : 'failed', result.ok ? null : result.error);
    await ctx.db.update(classroomDrafts).set({ runIds: sql`${classroomDrafts.runIds} || ${JSON.stringify(result.runs.map((r) => r.runId))}::jsonb` }).where(eq(classroomDrafts.id, id));
    await ctx.db.transaction(async (tx) => {
      await tx.select().from(classSections).where(eq(classSections.id, draft.sectionId)).for('update');
      const [current] = await tx.select().from(classroomDrafts).where(eq(classroomDrafts.id, id)).for('update');
      if (current!.reviewState !== 'suggested' || current!.generationState !== 'running' || current!.revision !== draft.revision || current!.expiresAt <= ctx.now()) return;
      const liveActor = await buildActor(tx, user);
      await requirePulse({ ...ctx, db: tx }, liveActor, draft.sectionId);
      await payloadFor(tx, ctx, liveActor, current!);
      if (!result.ok) { await tx.update(classroomDrafts).set({ generationState: 'failed', error: result.error, runId: result.runs[0]?.runId ?? null, updatedAt: ctx.now() }).where(eq(classroomDrafts.id, id)); return; }
      await tx.insert(artifactRevisions).values({ id: newId(), draftId: id, revision: 1, content: result.content, createdBy: 'ai' }).onConflictDoNothing();
      await tx.update(classroomDrafts).set({ generationState: 'ready', revision: 1, runId: result.runs[0]!.runId, error: null, updatedAt: ctx.now() }).where(eq(classroomDrafts.id, id));
    });
  } catch {
    // Provider errors can include submitted text; only store a bounded neutral failure.
    await ctx.db.update(classroomDrafts).set({ generationState: 'failed', error: 'Generation unavailable. Check prompt promotion and current source access, then retry.', updatedAt: ctx.now() }).where(and(eq(classroomDrafts.id, id), eq(classroomDrafts.reviewState, 'suggested'), inArray(classroomDrafts.generationState, ['queued', 'running'])));
  }
}

export async function editArtifact(ctx: AppContext, actor: Actor, id: string, expectedRevision: number, input: ArtifactContent) {
  const content = ArtifactContent.parse(input);
  const draft = await draftFor(ctx, actor, id);
  await validateClassroomText(ctx.db, draft.sectionId, content);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, draft.sectionId)).for('update');
    const [current] = await tx.select().from(classroomDrafts).where(eq(classroomDrafts.id, id)).for('update');
    if (current!.revision !== expectedRevision || current!.generationState !== 'ready' || ['discarded', 'stale'].includes(current!.reviewState) || current!.expiresAt <= ctx.now()) throw conflict('Draft changed or expired. Reload before editing.');
    const failures = checkClassroomArtifact(await payloadFor(tx, ctx, actor, current!), content);
    if (failures.length) throw badRequest(failures.join('; '));
    const revision = expectedRevision + 1;
    await tx.insert(artifactRevisions).values({ id: newId(), draftId: id, revision, content, createdBy: actor.userId });
    await tx.update(classroomDrafts).set({ revision, reviewState: 'suggested', publicationState: 'unpublished', updatedAt: ctx.now() }).where(eq(classroomDrafts.id, id));
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'artifact.edit', targetType: 'classroom_draft', targetId: id, metadata: { revision, previousRevision: expectedRevision } });
    return { id, revision };
  });
}
export async function approveArtifact(ctx: AppContext, actor: Actor, id: string, expectedRevision: number, audience: 'teacher' | 'student' | 'family') {
  const draft = await draftFor(ctx, actor, id);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, draft.sectionId)).for('update');
    const [current] = await tx.select().from(classroomDrafts).where(eq(classroomDrafts.id, id)).for('update');
    if (current!.revision !== expectedRevision || current!.generationState !== 'ready' || ['discarded', 'stale'].includes(current!.reviewState) || current!.expiresAt <= ctx.now()) throw conflict('Draft changed or expired. Review its current version.');
    if (audience !== 'teacher' && !['parent_message', 'positive_note'].includes(current!.kind)) throw badRequest('This artifact is restricted to the teacher');
    const payload = await payloadFor(tx, ctx, actor, current!);
    const [revision] = await tx.select().from(artifactRevisions).where(and(eq(artifactRevisions.draftId, id), eq(artifactRevisions.revision, expectedRevision)));
    const failures = checkClassroomArtifact(payload, revision!.content);
    if (failures.length) throw badRequest(failures.join('; '));
    const [previous] = await tx.select().from(artifactPublications).where(and(eq(artifactPublications.draftId, id), eq(artifactPublications.revision, expectedRevision)));
    if (previous) { if (previous.audience !== audience) throw conflict('This version was approved for a different audience'); return previous; }
    const [publication] = await tx.insert(artifactPublications).values({ id: newId(), draftId: id, revision: expectedRevision, audience, approvedBy: actor.userId, approvedAt: ctx.now() }).returning();
    await tx.update(classroomDrafts).set({ reviewState: 'approved', publicationState: 'logged', updatedAt: ctx.now() }).where(eq(classroomDrafts.id, id));
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'artifact.approve', targetType: 'classroom_draft', targetId: id, metadata: { revision: expectedRevision, audience, publicationId: publication!.id, delivery: 'not_sent' } });
    return publication!;
  });
}
export async function decideArtifact(ctx: AppContext, actor: Actor, id: string, expectedRevision: number, decision: 'discard' | 'defer', until?: Date) {
  const draft = await draftFor(ctx, actor, id);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, draft.sectionId)).for('update');
    const [current] = await tx.select().from(classroomDrafts).where(eq(classroomDrafts.id, id)).for('update');
    if (current!.revision !== expectedRevision || current!.reviewState === 'approved') throw conflict('Draft changed or was already approved');
    if (decision === 'defer' && (!until || until <= ctx.now() || until >= current!.expiresAt)) throw badRequest('Choose a time before this draft expires');
    await tx.update(classroomDrafts).set(decision === 'discard' ? { reviewState: 'discarded', updatedAt: ctx.now() } : { deferredUntil: until!, updatedAt: ctx.now() }).where(eq(classroomDrafts.id, id));
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: decision === 'discard' ? 'artifact.discard' : 'artifact.defer', targetType: 'classroom_draft', targetId: id, metadata: { revision: expectedRevision } });
    return { ok: true };
  });
}
export async function exportArtifact(ctx: AppContext, actor: Actor, id: string) {
  const result = await readArtifact(ctx, actor, id);
  if (result.draft.reviewState !== 'approved' || result.draft.publicationState !== 'logged') throw conflict('Approve the current version before exporting');
  const publication = result.publications.find((p) => p.revision === result.draft.revision)!;
  const content = result.revisions.find((r) => r.revision === result.draft.revision)!.content;
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'artifact.export', targetType: 'classroom_draft', targetId: id, metadata: { revision: result.draft.revision, audience: publication.audience } });
  const [session] = await ctx.db.select({ date: classSessions.date, topic: classSessions.topic, sectionName: classSections.name }).from(classSessions).innerJoin(classSections, eq(classSections.id, classSessions.sectionId)).where(eq(classSessions.id, result.draft.sessionId));
  return {
    kind: result.draft.kind, content, publication, sources: result.draft.sources, sourceContext: result.sourceContext, evidence: result.evidence, session: session ?? null, delivery: 'not_sent',
    template: result.template,
    // Kept for older clients: a report whose template no educator has validated yet.
    templateStatus: result.template && !result.template.validation ? 'template_pending_educator_validation' : null,
  };
}

/** Portal sharing is a distinct, explicit action after exact-audience approval. */
export async function shareArtifact(ctx: AppContext, actor: Actor, id: string, expectedRevision: number, shared: boolean) {
  const draft = await draftFor(ctx, actor, id);
  return ctx.db.transaction(async (tx) => {
    await tx.select().from(classSections).where(eq(classSections.id, draft.sectionId)).for('update');
    const detail = await readArtifact({ ...ctx, db: tx }, actor, id);
    if (detail.draft.revision !== expectedRevision || detail.draft.reviewState !== 'approved' || detail.draft.publicationState !== 'logged') throw conflict('Review and approve the current version before sharing');
    const publication = detail.publications.find((p) => p.revision === expectedRevision);
    if (!publication || publication.audience === 'teacher' || !['positive_note', 'parent_message'].includes(draft.kind)) throw badRequest('Approve a communication for a student or family audience first');
    if (shared) await tx.insert(artifactShares).values({ publicationId: publication.id, sharedBy: actor.userId, sharedAt: ctx.now() }).onConflictDoUpdate({ target: artifactShares.publicationId, set: { sharedBy: actor.userId, sharedAt: ctx.now(), revokedAt: null } });
    else await tx.update(artifactShares).set({ revokedAt: ctx.now() }).where(eq(artifactShares.publicationId, publication.id));
    await audit(tx, { actorUserId: actor.userId, actorRole: 'teacher', action: 'artifact.share', targetType: 'classroom_draft', targetId: id, metadata: { revision: expectedRevision, audience: publication.audience, portalShared: shared, externalDelivery: 'not_sent' } });
    return { portalShared: shared, externalDelivery: 'not_sent' };
  });
}

/**
 * Bulk Teacher Confirm: each item names its exact version, and each is decided through the same
 * single-item path (same checks, same audit). Approval here is teacher-only; choosing a student or
 * family audience stays an individual decision. One failure does not undo the others.
 */
export async function bulkDecide(ctx: AppContext, actor: Actor, decision: 'approve' | 'defer' | 'discard', items: Array<{ id: string; expectedRevision: number }>) {
  const results = [];
  for (const item of items) {
    try {
      if (decision === 'approve') await approveArtifact(ctx, actor, item.id, item.expectedRevision, 'teacher');
      else await decideArtifact(ctx, actor, item.id, item.expectedRevision, decision, decision === 'defer' ? new Date(ctx.now().getTime() + 86400000) : undefined);
      results.push({ id: item.id, ok: true as const });
    } catch (e) { results.push({ id: item.id, ok: false as const, error: e instanceof Error ? e.message : 'Could not decide' }); }
  }
  return { results };
}
