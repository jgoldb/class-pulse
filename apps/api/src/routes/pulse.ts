import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { organizations, schools } from '../db/schema';
import { ArtifactContent, CaptureEvent, RequestArtifact, ReviseEvent, SeatingInput, SessionInput, TomorrowSchedule } from '@class-pulse/domain';
import { getTomorrowSchedule, prepareTomorrowNow, saveTomorrowSchedule, tomorrowBundle } from '../services/tomorrow';
import { projectEvent } from '../services/projection';
import { CreateFollowUp, UpdateFollowUp } from '@class-pulse/domain';
import { createFollowUp, listFollowUps, updateFollowUp } from '../services/follow-ups';
import { CorrectContribution, RespondContribution, SubmitContribution } from '@class-pulse/domain';
import { learnerProfile, listProfilePeople } from '../services/profiles';
import { acknowledgeClassroomHelp, correctContribution, listClassroomHelp, listContributions, requestClassroomHelp, respondContribution, submitContribution, withdrawContribution } from '../services/contributions';
import { shareArtifact } from '../services/artifacts';
import { RequestPlanRevision } from '@class-pulse/domain';
import { listClassroomPlanRevisions, requestPlanRevision } from '../services/classroom-plan-revisions';
import { pulseInsights } from '../services/pulse-insights';
import { captureVocabulary, saveCaptureVocabulary } from '../services/preferences';
import { listReportTemplates, setTemplateValidation, TEMPLATE_KINDS } from '../services/report-templates';
import { eraseLearnerClassroomData, exportLearner, listLearners } from '../services/learner-records';
import { listVoiceApprovals, setVoiceApproval, transcribeVoice, VOICE_LIMITS, voiceStatus } from '../services/voice';
import { CaptureVocabulary } from '@class-pulse/domain';
import { approveArtifact, bulkDecide, decideArtifact, editArtifact, exportArtifact, listArtifacts, readArtifact, requestArtifact, retryArtifact } from '../services/artifacts';
import type { AppContext } from '../context';
import { badRequest, forbidden } from '../context';
import { audit } from '../services/audit';
import { captureEvent, configurePulse, confirmEvent, getSeating, listSessions, openSession, pulseSections, reviseEvent, saveSeating, sessionEvents, withdrawEvent } from '../services/pulse';

const Id = z.object({ id: z.string().uuid() });
const Version = z.object({ expectedRevision: z.number().int().positive() }).strict();
export function registerPulseRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/pulse/insights', (req) => pulseInsights(ctx, req.actor!));
  // Voice notes arrive as raw audio; nothing is written to disk.
  app.addContentTypeParser(/^audio\//, { parseAs: 'buffer', bodyLimit: VOICE_LIMITS.maxBytes + 1 }, (_req, body, done) => done(null, body));
  app.get('/api/pulse/voice/status', (req) => voiceStatus(ctx, req.actor!, z.object({ sectionId: z.string() }).parse(req.query).sectionId));
  app.post('/api/pulse/voice/transcribe', (req) => {
    if (!Buffer.isBuffer(req.body)) throw badRequest('Send the voice note as audio');
    return transcribeVoice(ctx, req.actor!, z.object({ sectionId: z.string() }).parse(req.query).sectionId, req.body, req.headers['content-type'] ?? '');
  });
  app.get('/api/pulse/voice/approvals', (req) => listVoiceApprovals(ctx, req.actor!));
  app.post('/api/pulse/voice/approvals', (req) => setVoiceApproval(ctx, req.actor!, z.object({ schoolId: z.string(), approved: z.boolean(), provider: z.string().trim().min(1).max(100).optional(), approvedByName: z.string().trim().min(1).max(200).optional(), approvedByTitle: z.string().trim().min(1).max(200).optional(), policyReference: z.string().trim().min(1).max(500).optional() }).strict().parse(req.body)));
  app.get('/api/pulse/report-templates', (req) => listReportTemplates(ctx, req.actor!));
  app.post('/api/pulse/report-templates', (req) => setTemplateValidation(ctx, req.actor!, z.object({ schoolId: z.string(), kind: z.enum(TEMPLATE_KINDS), validated: z.boolean(), notes: z.string().trim().max(2000) }).strict().parse(req.body)));
  app.get('/api/pulse/vocabulary', (req) => captureVocabulary(ctx, req.actor!));
  app.post('/api/pulse/vocabulary', (req) => saveCaptureVocabulary(ctx, req.actor!, z.object({ vocabulary: CaptureVocabulary.nullable() }).strict().parse(req.body).vocabulary));
  app.get('/api/pulse/plan-revisions', (req) => listClassroomPlanRevisions(ctx, req.actor!));
  app.post('/api/pulse/plan-revisions', (req) => requestPlanRevision(ctx, req.actor!, RequestPlanRevision.parse(req.body)));
  const profileQuery = z.object({ role: z.enum(['teacher', 'student', 'guardian']), sectionId: z.string().min(1) });
  app.get('/api/pulse/people', (req) => listProfilePeople(ctx, req.actor!, profileQuery.omit({ sectionId: true }).parse(req.query).role));
  app.get('/api/pulse/people/:studentId', (req) => {
    const q = profileQuery.parse(req.query);
    return learnerProfile(ctx, req.actor!, z.object({ studentId: z.string() }).parse(req.params).studentId, q.sectionId, q.role);
  });
  app.get('/api/pulse/contributions', (req) => {
    const q = z.object({ sectionId: z.string(), studentId: z.string().optional() }).parse(req.query);
    return listContributions(ctx, req.actor!, q.sectionId, q.studentId);
  });
  app.post('/api/pulse/contributions', (req) => submitContribution(ctx, req.actor!, SubmitContribution.parse(req.body)));
  app.post('/api/pulse/contributions/:id/respond', (req) => respondContribution(ctx, req.actor!, Id.parse(req.params).id, RespondContribution.parse(req.body)));
  app.post('/api/pulse/contributions/:id/correct', (req) => correctContribution(ctx, req.actor!, Id.parse(req.params).id, CorrectContribution.parse(req.body)));
  app.post('/api/pulse/contributions/:id/withdraw', (req) => withdrawContribution(ctx, req.actor!, Id.parse(req.params).id, Version.parse(req.body).expectedRevision));
  app.post('/api/pulse/help', (req) => requestClassroomHelp(ctx, req.actor!, z.object({ requestId: z.string().uuid(), studentId: z.string(), sectionId: z.string(), recipientId: z.string(), role: z.enum(['student', 'guardian']), description: z.string().trim().min(1).max(2000) }).strict().parse(req.body)));
  app.get('/api/pulse/help', (req) => listClassroomHelp(ctx, req.actor!, z.object({ sectionId: z.string() }).parse(req.query).sectionId));
  app.post('/api/pulse/help/:id/acknowledge', (req) => acknowledgeClassroomHelp(ctx, req.actor!, Id.parse(req.params).id));
  app.post('/api/pulse/drafts/:id/share', (req) => {
    const body = Version.extend({ shared: z.boolean() }).parse(req.body);
    return shareArtifact(ctx, req.actor!, Id.parse(req.params).id, body.expectedRevision, body.shared);
  });
  app.get('/api/pulse/follow-ups', (req) => listFollowUps(ctx, req.actor!));
  app.post('/api/pulse/follow-ups', (req) => createFollowUp(ctx, req.actor!, CreateFollowUp.parse(req.body)));
  app.post('/api/pulse/follow-ups/:id', (req) => updateFollowUp(ctx, req.actor!, Id.parse(req.params).id, UpdateFollowUp.parse(req.body)));
  app.post('/api/pulse/events/:id/project', (req) => {
    const body = Version.extend({ caseKey: z.string(), goalId: z.string().nullable(), strategyId: z.string().nullable() }).parse(req.body);
    return projectEvent(ctx, req.actor!, Id.parse(req.params).id, body);
  });
  app.get('/api/pulse/tomorrow/:sectionId/bundle', (req) => tomorrowBundle(ctx, req.actor!, z.object({ sectionId: z.string() }).parse(req.params).sectionId));
  app.post('/api/pulse/tomorrow/:sectionId/prepare', (req) => prepareTomorrowNow(ctx, req.actor!, z.object({ sectionId: z.string() }).parse(req.params).sectionId));
  app.get('/api/pulse/tomorrow/:sectionId', (req) => getTomorrowSchedule(ctx, req.actor!, z.object({ sectionId: z.string() }).parse(req.params).sectionId));
  app.post('/api/pulse/tomorrow/:sectionId', (req) => saveTomorrowSchedule(ctx, req.actor!, z.object({ sectionId: z.string() }).parse(req.params).sectionId, TomorrowSchedule.parse(req.body)));
  app.get('/api/pulse/drafts', (req) => listArtifacts(ctx, req.actor!));
  app.post('/api/pulse/drafts', (req) => requestArtifact(ctx, req.actor!, RequestArtifact.parse(req.body)));
  app.get('/api/pulse/drafts/:id', (req) => readArtifact(ctx, req.actor!, Id.parse(req.params).id));
  app.post('/api/pulse/drafts/:id/retry', (req) => retryArtifact(ctx, req.actor!, Id.parse(req.params).id));
  app.post('/api/pulse/drafts/:id/edit', (req) => {
    const body = z.object({ expectedRevision: z.number().int().positive(), content: ArtifactContent }).strict().parse(req.body);
    return editArtifact(ctx, req.actor!, Id.parse(req.params).id, body.expectedRevision, body.content);
  });
  app.post('/api/pulse/drafts/:id/approve', (req) => {
    const body = Version.extend({ audience: z.enum(['teacher', 'student', 'family']) }).parse(req.body);
    return approveArtifact(ctx, req.actor!, Id.parse(req.params).id, body.expectedRevision, body.audience);
  });
  app.post('/api/pulse/drafts/:id/decide', (req) => {
    const body = z.object({ expectedRevision: z.number().int().min(0), decision: z.enum(['discard', 'defer']), until: z.string().datetime({ offset: true }).optional() }).strict().parse(req.body);
    return decideArtifact(ctx, req.actor!, Id.parse(req.params).id, body.expectedRevision, body.decision, body.until ? new Date(body.until) : undefined);
  });
  app.post('/api/pulse/drafts/bulk', (req) => {
    const body = z.object({ decision: z.enum(['approve', 'defer', 'discard']), items: z.array(z.object({ id: z.string().uuid(), expectedRevision: z.number().int().positive() }).strict()).min(1).max(50) }).strict().parse(req.body);
    return bulkDecide(ctx, req.actor!, body.decision, body.items);
  });
  app.post('/api/pulse/drafts/:id/export', (req) => exportArtifact(ctx, req.actor!, Id.parse(req.params).id));
  app.get('/api/pulse/sections', (req) => pulseSections(ctx, req.actor!));
  app.get('/api/pulse/settings', async (req) => {
    const ids = [...req.actor!.scope.adminSchoolIds];
    if (!ids.length) return [];
    return ctx.db.select({ schoolId: schools.id, name: schools.name, timezone: schools.timezone, enabled: organizations.pulseraEnabled, familyWellbeingCollection: schools.familyWellbeingCollection, pendingRetentionDays: schools.pendingRetentionDays, memoryWindowDays: schools.memoryWindowDays }).from(schools).innerJoin(organizations, eq(schools.orgId, organizations.id)).where(inArray(schools.id, ids));
  });
  app.post('/api/pulse/settings', (req) => {
    const body = z.object({ schoolId: z.string(), enabled: z.boolean(), timezone: z.string().min(1).max(100) }).strict().parse(req.body);
    return configurePulse(ctx, req.actor!, body.schoolId, body.enabled, body.timezone);
  });
  app.post('/api/pulse/settings/retention', async (req) => {
    const body = z.object({ schoolId: z.string(), pendingRetentionDays: z.number().int().min(1).max(90), memoryWindowDays: z.number().int().min(30).max(365) }).strict().parse(req.body);
    if (!req.actor!.scope.adminSchoolIds.has(body.schoolId)) throw forbidden('School is outside your administration');
    await ctx.db.update(schools).set({ pendingRetentionDays: body.pendingRetentionDays, memoryWindowDays: body.memoryWindowDays }).where(eq(schools.id, body.schoolId));
    await audit(ctx.db, { actorUserId: req.actor!.userId, actorRole: 'administrator', action: 'classroom.configure', targetType: 'school', targetId: body.schoolId, metadata: { pendingRetentionDays: body.pendingRetentionDays, memoryWindowDays: body.memoryWindowDays } });
    return body;
  });
  app.get('/api/pulse/learners', (req) => listLearners(ctx, req.actor!));
  app.get('/api/pulse/learners/:studentId/export', (req) => exportLearner(ctx, req.actor!, z.object({ studentId: z.string() }).parse(req.params).studentId));
  app.post('/api/pulse/learners/:studentId/erase', (req) => eraseLearnerClassroomData(ctx, req.actor!, z.object({ studentId: z.string() }).parse(req.params).studentId, z.object({ confirm: z.string() }).strict().parse(req.body).confirm));
  app.post('/api/pulse/settings/wellbeing', async (req) => {
    const body = z.object({ schoolId: z.string(), enabled: z.boolean() }).strict().parse(req.body);
    if (!req.actor!.scope.adminSchoolIds.has(body.schoolId)) throw forbidden('School is outside your administration');
    await ctx.db.update(schools).set({ familyWellbeingCollection: body.enabled }).where(eq(schools.id, body.schoolId));
    await audit(ctx.db, { actorUserId: req.actor!.userId, actorRole: 'administrator', action: 'classroom.configure', targetType: 'school', targetId: body.schoolId, metadata: { familyWellbeingCollection: body.enabled } });
    return { familyWellbeingCollection: body.enabled };
  });
  app.get('/api/pulse/seating', (req) => getSeating(ctx, req.actor!, z.object({ sectionId: z.string() }).parse(req.query).sectionId));
  app.post('/api/pulse/seating/:sectionId', (req) => saveSeating(ctx, req.actor!, z.object({ sectionId: z.string() }).parse(req.params).sectionId, SeatingInput.parse(req.body)));
  app.get('/api/pulse/sessions', (req) => listSessions(ctx, req.actor!, z.object({ sectionId: z.string() }).parse(req.query).sectionId));
  app.post('/api/pulse/sessions', (req) => openSession(ctx, req.actor!, SessionInput.parse(req.body)));
  app.get('/api/pulse/sessions/:id', (req) => sessionEvents(ctx, req.actor!, Id.parse(req.params).id));
  app.post('/api/pulse/events', (req) => captureEvent(ctx, req.actor!, CaptureEvent.parse(req.body)));
  app.post('/api/pulse/events/:id/revise', (req) => reviseEvent(ctx, req.actor!, Id.parse(req.params).id, ReviseEvent.parse(req.body)));
  app.post('/api/pulse/events/:id/confirm', (req) => confirmEvent(ctx, req.actor!, Id.parse(req.params).id, Version.parse(req.body).expectedRevision));
  app.post('/api/pulse/events/:id/withdraw', (req) => withdrawEvent(ctx, req.actor!, Id.parse(req.params).id, Version.parse(req.body).expectedRevision));
}
