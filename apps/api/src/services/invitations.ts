import { and, eq, isNull, type AnyColumn } from 'drizzle-orm';
import { newId, type Role } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { badRequest, conflict, notFound } from '../context';
import type { Db } from '../db/client';
import { classSections, invitations, roleAssignments, schools, students, users } from '../db/schema';
import { audit } from './audit';
import { assertScopeValid } from './roster';

/**
 * Invitation mechanics, shared by the two people who may issue one (docs/04): an administrator,
 * for any scope in their school, and a teacher, for the family or the student of a child on
 * their own roster. Who is *allowed* to grant a scope is the caller's decision; everything after
 * that decision is identical, and lives here so the two paths cannot drift apart.
 */

export interface InvitationScope {
  role: Role;
  schoolId: string | null;
  sectionId: string | null;
  studentId: string | null;
}

/**
 * The school an invitation's scope belongs to. Roles are scoped, never global, so whichever
 * scope field is set — school, section or student — decides which school (and therefore which
 * org's invitation list) the invitation belongs to.
 */
export async function schoolForInvitationScope(db: Db, scope: Omit<InvitationScope, 'role'>): Promise<string | null> {
  if (scope.sectionId) return (await db.select().from(classSections).where(eq(classSections.id, scope.sectionId)).limit(1))[0]?.schoolId ?? null;
  if (scope.studentId) return (await db.select().from(students).where(eq(students.id, scope.studentId)).limit(1))[0]?.schoolId ?? null;
  return scope.schoolId;
}

export interface IssuedInvitation {
  id: string;
  status: 'pending' | 'accepted';
  clerkInvitationId: string | null;
  existingUserId: string | null;
}

/**
 * Create the invitation. An email that already has a user row just gains the role assignment —
 * no second sign-up, no email. A new email gets a pending row and a Clerk invitation, and the
 * row is rolled back if Clerk refuses it so a pending invitation always has an email behind it.
 */
export async function issueInvitation(
  ctx: AppContext,
  actor: Actor,
  input: { scope: InvitationScope; email: string; schoolId: string; actorRole: Role },
): Promise<IssuedInvitation> {
  const { scope, schoolId, actorRole } = input;
  assertScopeValid(scope);
  const [school] = await ctx.db.select().from(schools).where(eq(schools.id, schoolId)).limit(1);
  if (!school) throw notFound('School not found');
  const email = input.email.toLowerCase();

  // Re-sending the same scope to the same address would mean two Clerk invitations and two role
  // assignments once accepted, so the same invitation twice is a conflict, not a second email.
  const sameScope = (col: AnyColumn, value: string | null) => (value === null ? isNull(col) : eq(col, value));
  const [pending] = await ctx.db
    .select()
    .from(invitations)
    .where(
      and(
        eq(invitations.email, email),
        eq(invitations.role, scope.role),
        eq(invitations.status, 'pending'),
        sameScope(invitations.schoolId, scope.schoolId),
        sameScope(invitations.sectionId, scope.sectionId),
        sameScope(invitations.studentId, scope.studentId),
      ),
    )
    .limit(1);
  if (pending) throw conflict('That invitation is already pending. Revoke it first if you want to send it again.');

  const [existing] = await ctx.db.select().from(users).where(eq(users.email, email)).limit(1);
  const id = newId();
  let clerkInvitationId: string | null = null;
  let existingUserId: string | null = null;

  if (existing) {
    // Already a member (any workspace): just add the role assignment; no email needed.
    existingUserId = existing.id;
    const [held] = await ctx.db
      .select()
      .from(roleAssignments)
      .where(
        and(
          eq(roleAssignments.userId, existing.id),
          eq(roleAssignments.role, scope.role),
          scope.sectionId ? eq(roleAssignments.sectionId, scope.sectionId) : scope.studentId ? eq(roleAssignments.studentId, scope.studentId) : eq(roleAssignments.schoolId, scope.schoolId!),
        ),
      )
      .limit(1);
    if (held) throw conflict('That person already has this access.');
    await ctx.db.insert(roleAssignments).values({ id: newId(), userId: existing.id, ...scope });
    await ctx.db.insert(invitations).values({ id, orgId: school.orgId, email, ...scope, status: 'accepted', invitedBy: actor.userId, userId: existing.id, acceptedAt: new Date() });
  } else {
    await ctx.db.insert(invitations).values({ id, orgId: school.orgId, email, ...scope, status: 'pending', invitedBy: actor.userId });
    try {
      const inv = await ctx.auth.client.invitations.createInvitation({
        emailAddress: email,
        redirectUrl: `${ctx.config.webOrigin}/sign-up`,
        publicMetadata: { invitationId: id, workspace: school.name },
        ignoreExisting: true,
      });
      clerkInvitationId = inv.id;
      await ctx.db.update(invitations).set({ clerkInvitationId }).where(eq(invitations.id, id));
    } catch (err) {
      await ctx.db.delete(invitations).where(eq(invitations.id, id));
      throw badRequest(`Could not send the invitation: ${(err as Error).message}`);
    }
  }

  await audit(ctx.db, {
    actorUserId: actor.userId,
    actorRole,
    action: 'authorization.grant',
    targetType: 'invitation',
    targetId: id,
    studentId: scope.studentId,
    metadata: { role: scope.role, sectionId: scope.sectionId, schoolId: scope.schoolId, existingUser: !!existing },
  });
  return { id, status: existing ? 'accepted' : 'pending', clerkInvitationId, existingUserId };
}

/**
 * Revoke a pending invitation. `authorize` is the caller's rule about this particular row — an
 * administrator's org, a teacher's roster — applied after the row is loaded and before anything
 * changes, so neither caller can revoke an invitation belonging to someone else. It returns the
 * role the actor is acting under, which is what the audit trail records.
 */
export async function revokePendingInvitation(
  ctx: AppContext,
  actor: Actor,
  id: string,
  authorize: (inv: typeof invitations.$inferSelect) => Role | Promise<Role>,
): Promise<void> {
  const [inv] = await ctx.db.select().from(invitations).where(and(eq(invitations.id, id), eq(invitations.status, 'pending'))).limit(1);
  if (!inv) throw notFound('Pending invitation not found');
  const actorRole = await authorize(inv);
  if (inv.clerkInvitationId) {
    try {
      await ctx.auth.client.invitations.revokeInvitation(inv.clerkInvitationId);
    } catch {
      /* already accepted or expired on Clerk's side */
    }
  }
  await ctx.db.update(invitations).set({ status: 'revoked' }).where(eq(invitations.id, id));
  await audit(ctx.db, { actorUserId: actor.userId, actorRole, action: 'authorization.revoke', targetType: 'invitation', targetId: id, studentId: inv.studentId });
}
