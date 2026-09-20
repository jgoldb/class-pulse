import type { FastifyInstance } from 'fastify';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { ROLES, newId } from '@class-pulse/domain';
import type { AppContext } from '../context';
import { badRequest, conflict, forbidden, notFound } from '../context';
import { checkoutSessions, classSections, invitations, organizations, roleAssignments, schools, sectionEnrollments, students, subscriptions, users } from '../db/schema';
import { identityDetails } from '../auth/clerk';
import { audit } from '../services/audit';
import { assertScopeValid } from '../services/roster';

export const PLANS = {
  classroom: { name: 'Classroom', seats: 5, monthlyCents: 4900, blurb: 'One school, up to 5 educator seats.' },
  school: { name: 'School', seats: 40, monthlyCents: 29900, blurb: 'Whole-school rollout, support team and administration views.' },
  district: { name: 'District', seats: 500, monthlyCents: 149900, blurb: 'Multiple schools, SSO, equity monitoring across sites.' },
} as const;
type PlanId = keyof typeof PLANS;

export function registerAuthRoutes(app: FastifyInstance, ctx: AppContext) {
  /** Who am I, and what can I do. Works for provisioned users and for signed-in people with no workspace yet. */
  app.get('/auth/me', async (req) => {
    const actor = req.actor;
    if (!actor) {
      return { authenticated: !!req.subject, provisioned: false, posture: ctx.config.deploymentPosture, modelEnabled: ctx.aiConfig.provider !== 'off' };
    }
    const sectionIds = [...actor.scope.teacherSectionIds];
    const sections = sectionIds.length ? await ctx.db.select().from(classSections).where(inArray(classSections.id, sectionIds)) : [];
    const schoolIds = new Set<string>([...actor.assignments.map((a) => a.schoolId).filter((x): x is string => !!x), ...sections.map((s) => s.schoolId)]);
    const schoolRows = schoolIds.size ? await ctx.db.select().from(schools).where(inArray(schools.id, [...schoolIds])) : [];
    const [org] = schoolRows.length ? await ctx.db.select().from(organizations).where(eq(organizations.id, schoolRows[0]!.orgId)).limit(1) : [];
    return {
      authenticated: true,
      provisioned: true,
      posture: ctx.config.deploymentPosture,
      // AI_PROVIDER=off: every surface that reaches the model will refuse, so the UI says so up front.
      modelEnabled: ctx.aiConfig.provider !== 'off',
      user: { id: actor.userId, email: actor.email, displayName: actor.displayName },
      roles: [...actor.roles],
      assignments: actor.assignments,
      sections: sections.map((s) => ({ id: s.id, name: s.name, periodTag: s.periodTag })),
      schools: schoolRows.map((s) => ({ id: s.id, name: s.name })),
      workspace: org ? { id: org.id, name: org.name } : null,
      caseCount: actor.scope.caseRoles.size,
      approverRoles: ctx.config.planApproverRoles,
    };
  });

  // ---- Sign-up: simulated Stripe checkout (the only stand-in in the product) ------------------
  app.get('/api/signup/plans', async () => Object.entries(PLANS).map(([id, p]) => ({ id, ...p })));

  app.post('/api/signup/checkout', async (req) => {
    const { plan, seats } = z.object({ plan: z.enum(Object.keys(PLANS) as [PlanId, ...PlanId[]]), seats: z.number().int().min(1).max(1000).optional() }).parse(req.body);
    const p = PLANS[plan];
    const id = `cs_sim_${newId().replace(/-/g, '').slice(0, 20)}`;
    const s = seats ?? p.seats;
    await ctx.db.insert(checkoutSessions).values({ id, plan, seats: s, amountCents: p.monthlyCents, status: 'open' });
    return { id, plan, seats: s, amountCents: p.monthlyCents, processor: 'simulated' };
  });

  app.get('/api/signup/checkout/:id', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const [row] = await ctx.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, id)).limit(1);
    if (!row) throw notFound('Checkout session not found');
    return { ...row, planName: PLANS[row.plan as PlanId]?.name ?? row.plan, processor: 'simulated' };
  });

  /** The stand-in for Stripe's hosted payment page confirming a payment. */
  app.post('/api/signup/checkout/:id/pay', async (req) => {
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const body = z.object({ cardholder: z.string().min(1).max(120), last4: z.string().regex(/^\d{4}$/) }).parse(req.body);
    const [row] = await ctx.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, id)).limit(1);
    if (!row) throw notFound('Checkout session not found');
    if (row.status === 'paid') return { ok: true, alreadyPaid: true };
    await ctx.db.update(checkoutSessions).set({ status: 'paid', paidAt: new Date() }).where(eq(checkoutSessions.id, id));
    void body;
    return { ok: true, receipt: `sim_${id.slice(-8)}` };
  });

  // ---- Onboarding: a signed-in person with a paid checkout creates their workspace -------------
  app.post('/api/onboarding/workspace', async (req) => {
    if (!req.subject) throw forbidden();
    if (req.actor) throw conflict('You already belong to a workspace');
    const body = z
      .object({
        checkoutId: z.string(),
        workspaceName: z.string().min(2).max(120),
        schoolName: z.string().min(2).max(120),
        firstSection: z.object({ name: z.string().min(1).max(120), gradeLevel: z.string().min(1).max(20), periodTag: z.string().nullable() }).nullable(),
      })
      .parse(req.body);
    const [checkout] = await ctx.db.select().from(checkoutSessions).where(eq(checkoutSessions.id, body.checkoutId)).limit(1);
    if (!checkout || checkout.status !== 'paid') throw badRequest('Complete checkout before creating a workspace');
    if (checkout.claimedByUserId) throw conflict('This checkout was already used');
    const identity = await identityDetails(ctx.auth, req.subject);
    if (!identity.email) throw badRequest('Your sign-in has no email address');

    const orgId = newId();
    const schoolId = newId();
    const userId = newId();
    const sectionId = body.firstSection ? newId() : null;
    await ctx.db.transaction(async (tx) => {
      await tx.insert(organizations).values({ id: orgId, name: body.workspaceName });
      await tx.insert(schools).values({ id: schoolId, orgId, name: body.schoolName });
      if (body.firstSection && sectionId) await tx.insert(classSections).values({ id: sectionId, schoolId, name: body.firstSection.name, gradeLevel: body.firstSection.gradeLevel, periodTag: body.firstSection.periodTag });
      await tx.insert(users).values({ id: userId, email: identity.email!.toLowerCase(), displayName: identity.name ?? identity.email!, authSubject: req.subject! });
      await tx.insert(roleAssignments).values({ id: newId(), userId, role: 'administrator', schoolId, sectionId: null, studentId: null });
      await tx.insert(subscriptions).values({ id: newId(), orgId, plan: checkout.plan, seats: checkout.seats, processor: 'simulated', processorRef: checkout.id, status: 'active', currentPeriodEnd: new Date(Date.now() + 30 * 86_400_000) });
      await tx.update(checkoutSessions).set({ claimedByUserId: userId }).where(eq(checkoutSessions.id, checkout.id));
    });
    await audit(ctx.db, { actorUserId: userId, actorRole: 'administrator', action: 'auth.login', targetType: 'organization', targetId: orgId, metadata: { created: true, plan: checkout.plan } });
    return { orgId, schoolId, sectionId, userId };
  });

  // ---- Invitations (administrator) -------------------------------------------------------------
  app.get('/api/admin/invitations', async (req) => {
    const actor = req.actor!;
    if (!actor.roles.has('administrator')) throw forbidden('Administrator role required');
    const schoolIds = [...actor.scope.adminSchoolIds];
    if (!schoolIds.length) return [];
    const orgIds = (await ctx.db.select({ orgId: schools.orgId }).from(schools).where(inArray(schools.id, schoolIds))).map((s) => s.orgId);
    return ctx.db.select().from(invitations).where(inArray(invitations.orgId, orgIds)).orderBy(desc(invitations.createdAt));
  });

  app.post('/api/admin/invitations', async (req) => {
    const actor = req.actor!;
    if (!actor.roles.has('administrator')) throw forbidden('Administrator role required');
    const body = z
      .object({
        email: z.string().email(),
        displayName: z.string().max(120).optional(),
        role: z.enum(ROLES),
        schoolId: z.string().nullable().optional(),
        sectionId: z.string().nullable().optional(),
        studentId: z.string().nullable().optional(),
      })
      .parse(req.body);
    const scope = { role: body.role, schoolId: body.schoolId ?? null, sectionId: body.sectionId ?? null, studentId: body.studentId ?? null };
    assertScopeValid(scope);
    // Resolve the school the scope belongs to and check it is one of the administrator's.
    let schoolId = scope.schoolId;
    if (scope.sectionId) schoolId = (await ctx.db.select().from(classSections).where(eq(classSections.id, scope.sectionId)).limit(1))[0]?.schoolId ?? null;
    if (scope.studentId) schoolId = (await ctx.db.select().from(students).where(eq(students.id, scope.studentId)).limit(1))[0]?.schoolId ?? null;
    if (!schoolId || !actor.scope.adminSchoolIds.has(schoolId)) throw forbidden('That scope is outside your school');
    const [school] = await ctx.db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
    const email = body.email.toLowerCase();
    const [existing] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
    const id = newId();
    let clerkInvitationId: string | null = null;
    let existingUserId: string | null = null;
    if (existing) {
      // Already a member (any workspace): just add the role assignment; no email needed.
      existingUserId = existing.id;
      await ctx.db.insert(roleAssignments).values({ id: newId(), userId: existing.id, ...scope });
      await ctx.db.insert(invitations).values({ id, orgId: school!.orgId, email, ...scope, status: 'accepted', invitedBy: actor.userId, userId: existing.id, acceptedAt: new Date() });
    } else {
      await ctx.db.insert(invitations).values({ id, orgId: school!.orgId, email, ...scope, status: 'pending', invitedBy: actor.userId });
      try {
        const inv = await ctx.auth.client.invitations.createInvitation({
          emailAddress: email,
          redirectUrl: `${ctx.config.webOrigin}/sign-up`,
          publicMetadata: { invitationId: id, workspace: school!.name },
          ignoreExisting: true,
        });
        clerkInvitationId = inv.id;
        await ctx.db.update(invitations).set({ clerkInvitationId }).where(eq(invitations.id, id));
      } catch (err) {
        await ctx.db.delete(invitations).where(eq(invitations.id, id));
        throw badRequest(`Could not send the invitation: ${(err as Error).message}`);
      }
    }
    await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'administrator', action: 'authorization.grant', targetType: 'invitation', targetId: id, studentId: scope.studentId, metadata: { role: body.role, sectionId: scope.sectionId, existingUser: !!existing } });
    return { id, status: existing ? 'accepted' : 'pending', clerkInvitationId, existingUserId };
  });

  app.post('/api/admin/invitations/:id/revoke', async (req) => {
    const actor = req.actor!;
    if (!actor.roles.has('administrator')) throw forbidden('Administrator role required');
    const { id } = z.object({ id: z.string() }).parse(req.params);
    const [inv] = await ctx.db.select().from(invitations).where(and(eq(invitations.id, id), eq(invitations.status, 'pending'))).limit(1);
    if (!inv) throw notFound('Pending invitation not found');
    if (inv.clerkInvitationId) {
      try {
        await ctx.auth.client.invitations.revokeInvitation(inv.clerkInvitationId);
      } catch {
        /* already accepted or expired on Clerk's side */
      }
    }
    await ctx.db.update(invitations).set({ status: 'revoked' }).where(eq(invitations.id, id));
    await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'administrator', action: 'authorization.revoke', targetType: 'invitation', targetId: id });
    return { ok: true };
  });

  /** Workspace structure the admin needs when inviting: sections and students of their schools. */
  app.get('/api/admin/structure', async (req) => {
    const actor = req.actor!;
    if (!actor.roles.has('administrator')) throw forbidden('Administrator role required');
    const schoolIds = [...actor.scope.adminSchoolIds];
    if (!schoolIds.length) return { schools: [], sections: [], students: [] };
    const [schoolRows, sectionRows, studentRows] = await Promise.all([
      ctx.db.select().from(schools).where(inArray(schools.id, schoolIds)),
      ctx.db.select().from(classSections).where(inArray(classSections.schoolId, schoolIds)),
      ctx.db.select({ id: students.id, firstName: students.firstName, lastName: students.lastName, gradeLevel: students.gradeLevel, schoolId: students.schoolId }).from(students).where(inArray(students.schoolId, schoolIds)),
    ]);
    const enrollments = sectionRows.length ? await ctx.db.select().from(sectionEnrollments).where(inArray(sectionEnrollments.sectionId, sectionRows.map((s) => s.id))) : [];
    await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'administrator', action: 'student.list', targetType: 'student', metadata: { purpose: 'invitation_structure', count: studentRows.length } });
    return {
      schools: schoolRows.map((s) => ({ id: s.id, name: s.name })),
      sections: sectionRows.map((s) => ({ id: s.id, name: s.name, gradeLevel: s.gradeLevel, schoolId: s.schoolId, periodTag: s.periodTag })),
      students: studentRows.map((s) => ({ id: s.id, displayName: `${s.firstName} ${s.lastName}`, gradeLevel: s.gradeLevel, schoolId: s.schoolId })),
      enrollments: enrollments.map((e) => ({ sectionId: e.sectionId, studentId: e.studentId })),
    };
  });
}
