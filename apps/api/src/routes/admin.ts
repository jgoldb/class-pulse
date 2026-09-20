import type { FastifyInstance } from 'fastify';
import { desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { AI_SURFACES, PATTERN_DEFINITION_STATUSES, newId, type PromptVersion } from '@class-pulse/domain';
import { runEvals } from '@class-pulse/ai/evals';
import { modelResolverFromConfig } from '@class-pulse/ai';
import type { AppContext } from '../context';
import { badRequest, forbidden } from '../context';
import { classSections, egressLog, jobs, roleAssignments, sectionEnrollments, students, users } from '../db/schema';
import { auditViewer, catalogHealth, draftDiffAggregate, equityMonitor, quickEntryHealth, trends } from '../services/admin';
import { audit } from '../services/audit';
import { setDefinitionStatus } from '../services/patterns';
import { createPromptVersion, listPrompts, promotePrompt, promptBody, recordEvalRun } from '../services/prompts';
import { grantAuthorization, listAuthorizations, revokeAuthorization } from '../services/roster';

const Id = z.object({ id: z.string() });

export function registerAdminRoutes(app: FastifyInstance, ctx: AppContext) {
  app.addHook('preHandler', async (req) => {
    if (req.url.startsWith('/api/admin') && !req.actor?.roles.has('administrator')) throw forbidden('Administrator role required');
  });

  app.get('/api/admin/trends', async (req) => trends(ctx, req.actor!));
  app.get('/api/admin/catalog', async (req) => catalogHealth(ctx, req.actor!));
  app.get('/api/admin/equity', async (req) => equityMonitor(ctx, req.actor!));
  app.get('/api/admin/draft-diffs', async (req) => draftDiffAggregate(ctx, req.actor!));
  app.get('/api/admin/quick-entry', async (req) => quickEntryHealth(ctx, req.actor!));
  app.get('/api/admin/audit', async (req) => {
    const q = z.object({ studentId: z.string().optional(), caseKey: z.string().optional(), action: z.string().optional(), limit: z.coerce.number().int().max(500).optional() }).parse(req.query);
    return auditViewer(ctx, req.actor!, q);
  });

  app.post('/api/admin/definitions/:id/status', async (req) => {
    const { id } = Id.parse(req.params);
    const body = z.object({ status: z.enum(PATTERN_DEFINITION_STATUSES), reviewer: z.string().nullable().optional() }).parse(req.body);
    await setDefinitionStatus(ctx, req.actor!, id, body.status, body.reviewer ?? null);
    return { ok: true };
  });

  // ---- Prompt registry -----------------------------------------------------------------------
  app.get('/api/admin/prompts', async () => listPrompts(ctx.db));
  app.get('/api/admin/prompts/:id', async (req) => promptBody(ctx.db, Id.parse(req.params).id));
  app.post('/api/admin/prompts', async (req) => {
    const body = z
      .object({
        surface: z.enum(AI_SURFACES),
        body: z.string().min(50),
        model: z.string().min(1).default('default'),
        params: z.object({ reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).nullable(), maxTokens: z.number().int().positive() }),
        changelog: z.string().min(5),
      })
      .parse(req.body);
    return { id: await createPromptVersion(ctx.db, { ...body, createdBy: req.actor!.userId }) };
  });
  app.post('/api/admin/prompts/:id/promote', async (req) => {
    const { id } = Id.parse(req.params);
    await promotePrompt(ctx.db, id, req.actor!.userId);
    await audit(ctx.db, { actorUserId: req.actor!.userId, actorRole: 'administrator', action: 'prompt.promote', targetType: 'prompt_version', targetId: id });
    return { ok: true };
  });
  /** Run the eval suite against a prompt version and record the result (the promotion gate). */
  app.post('/api/admin/prompts/:id/evals', async (req) => {
    const { id } = Id.parse(req.params);
    const prompt = await promptBody(ctx.db, id);
    const { judge } = z.object({ judge: z.boolean().default(true) }).parse(req.body ?? {});
    const report = await runEvals({
      provider: ctx.provider,
      resolveModel: modelResolverFromConfig(ctx.aiConfig),
      posture: ctx.aiConfig.posture,
      planPrompt: prompt.surface === 'plan_generation' ? { ...prompt, params: prompt.params as PromptVersion['params'] } : undefined,
      judge,
    });
    const runId = await recordEvalRun(ctx.db, { promptVersionId: id, provider: report.provider, model: report.model, passed: report.passed, passedCases: report.passedCases, totalCases: report.totalCases, report });
    return { runId, passed: report.passed, passedCases: report.passedCases, totalCases: report.totalCases, rubricMeans: report.rubricMeans, cases: report.cases.map((c) => ({ id: c.id, title: c.title, passed: c.passed, status: c.status, failures: c.assertions.filter((a) => !a.passed) })) };
  });

  // ---- School structure (manual until an SIS import exists — open question #3) ----------------
  app.post('/api/admin/sections', async (req) => {
    const body = z.object({ schoolId: z.string(), name: z.string().min(1).max(120), gradeLevel: z.string().min(1).max(20), periodTag: z.string().nullable().optional() }).parse(req.body);
    if (!req.actor!.scope.adminSchoolIds.has(body.schoolId)) throw forbidden('School is outside your administration');
    const id = newId();
    await ctx.db.insert(classSections).values({ id, schoolId: body.schoolId, name: body.name, gradeLevel: body.gradeLevel, periodTag: body.periodTag ?? null });
    return { id };
  });
  app.post('/api/admin/students', async (req) => {
    const body = z.object({ schoolId: z.string(), firstName: z.string().min(1).max(80), lastName: z.string().min(1).max(80), gradeLevel: z.string().min(1).max(20), sectionId: z.string().nullable().optional(), externalId: z.string().max(80).nullable().optional() }).parse(req.body);
    if (!req.actor!.scope.adminSchoolIds.has(body.schoolId)) throw forbidden('School is outside your administration');
    if (body.sectionId) {
      const [sec] = await ctx.db.select().from(classSections).where(eq(classSections.id, body.sectionId)).limit(1);
      if (!sec || sec.schoolId !== body.schoolId) throw badRequest('Section is not in that school');
    }
    const id = newId();
    await ctx.db.transaction(async (tx) => {
      await tx.insert(students).values({ id, schoolId: body.schoolId, firstName: body.firstName, lastName: body.lastName, gradeLevel: body.gradeLevel, externalId: body.externalId ?? null, synthetic: ctx.config.deploymentPosture === 'demonstration' });
      if (body.sectionId) await tx.insert(sectionEnrollments).values({ sectionId: body.sectionId, studentId: id });
    });
    await audit(ctx.db, { actorUserId: req.actor!.userId, actorRole: 'administrator', action: 'student.list', targetType: 'student', targetId: id, studentId: id, metadata: { created: true, sectionId: body.sectionId ?? null } });
    return { id };
  });
  app.post('/api/admin/enrollments', async (req) => {
    const body = z.object({ sectionId: z.string(), studentId: z.string() }).parse(req.body);
    const [sec] = await ctx.db.select().from(classSections).where(eq(classSections.id, body.sectionId)).limit(1);
    if (!sec || !req.actor!.scope.adminSchoolIds.has(sec.schoolId)) throw forbidden('Section is outside your administration');
    await ctx.db.insert(sectionEnrollments).values(body).onConflictDoNothing();
    return { ok: true };
  });

  // ---- Observability (docs/04 egress log: prove what left; docs/05 observability) ------------
  app.get('/api/admin/egress', async (req) => {
    const q = z.object({ limit: z.coerce.number().int().max(200).default(50), caseKey: z.string().optional() }).parse(req.query);
    const rows = await ctx.db.select().from(egressLog).where(q.caseKey ? eq(egressLog.caseKey, q.caseKey) : undefined).orderBy(desc(egressLog.at)).limit(q.limit);
    // Payloads are de-identified by construction, but the admin view still omits them: metadata only.
    return rows.map(({ instructions: _i, input: _in, ...r }) => ({ ...r, inputChars: _in.length }));
  });
  app.get('/api/admin/jobs', async (req) => {
    const q = z.object({ status: z.string().optional(), limit: z.coerce.number().int().max(200).default(50) }).parse(req.query);
    return ctx.db.select().from(jobs).where(q.status ? eq(jobs.status, q.status) : undefined).orderBy(desc(jobs.updatedAt)).limit(q.limit);
  });

  // ---- Individual access authorization ------------------------------------------------------
  app.get('/api/admin/authorizations', async (req) => listAuthorizations(ctx.db, req.actor!));
  app.post('/api/admin/authorizations', async (req) => {
    const body = z.object({ adminUserId: z.string(), studentId: z.string(), reason: z.string().min(5).max(1000), days: z.number().int().min(1).max(90).default(14) }).parse(req.body);
    return grantAuthorization(ctx.db, req.actor!, body);
  });
  app.post('/api/admin/authorizations/:id/revoke', async (req) => {
    await revokeAuthorization(ctx.db, req.actor!, Id.parse(req.params).id);
    return { ok: true };
  });
  /** Pick lists for the grant form — restricted to the administrator's own schools and audited. */
  app.get('/api/admin/directory', async (req) => {
    const schoolIds = [...req.actor!.scope.adminSchoolIds];
    if (!schoolIds.length) return { admins: [], students: [] };
    const admins = await ctx.db
      .select({ id: users.id, displayName: users.displayName })
      .from(roleAssignments)
      .innerJoin(users, eq(users.id, roleAssignments.userId))
      .where(inArray(roleAssignments.schoolId, schoolIds));
    const rows = await ctx.db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName, gradeLevel: students.gradeLevel }).from(students).where(inArray(students.schoolId, schoolIds));
    await audit(ctx.db, { actorUserId: req.actor!.userId, actorRole: 'administrator', action: 'student.list', targetType: 'student', metadata: { purpose: 'authorization_directory', count: rows.length } });
    return { admins: [...new Map(admins.map((a) => [a.id, a])).values()], students: rows.map((s) => ({ id: s.id, displayName: `${s.firstName} ${s.lastName}`, gradeLevel: s.gradeLevel })) };
  });
}
