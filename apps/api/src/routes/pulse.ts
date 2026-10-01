import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { organizations, schools } from '../db/schema';
import { ArtifactContent, CaptureEvent, RequestArtifact, ReviseEvent, SeatingInput, SessionInput, TomorrowSchedule } from '@class-pulse/domain';
import { getTomorrowSchedule, saveTomorrowSchedule } from '../services/tomorrow';
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
import { approveArtifact, decideArtifact, editArtifact, exportArtifact, listArtifacts, readArtifact, requestArtifact, retryArtifact } from '../services/artifacts';
import type { AppContext } from '../context';
import { captureEvent, configurePulse, confirmEvent, getSeating, listSessions, openSession, pulseSections, reviseEvent, saveSeating, sessionEvents, withdrawEvent } from '../services/pulse';

const Id = z.object({ id: z.string().uuid() });
const Version = z.object({ expectedRevision: z.number().int().positive() }).strict();
export function registerPulseRoutes(app: FastifyInstance, ctx: AppContext) {
  app.get('/api/pulse/insights', (req) => pulseInsights(ctx, req.actor!));
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
  app.post('/api/pulse/drafts/:id/export', (req) => exportArtifact(ctx, req.actor!, Id.parse(req.params).id));
  app.get('/api/pulse/sections', (req) => pulseSections(ctx, req.actor!));
  app.get('/api/pulse/settings', async (req) => {
    const ids = [...req.actor!.scope.adminSchoolIds];
    if (!ids.length) return [];
    return ctx.db.select({ schoolId: schools.id, name: schools.name, timezone: schools.timezone, enabled: organizations.pulseraEnabled }).from(schools).innerJoin(organizations, eq(schools.orgId, organizations.id)).where(inArray(schools.id, ids));
  });
  app.post('/api/pulse/settings', (req) => {
    const body = z.object({ schoolId: z.string(), enabled: z.boolean(), timezone: z.string().min(1).max(100) }).strict().parse(req.body);
    return configurePulse(ctx, req.actor!, body.schoolId, body.enabled, body.timezone);
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
