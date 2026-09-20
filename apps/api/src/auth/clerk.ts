import { createClerkClient, verifyToken, type ClerkClient } from '@clerk/backend';
import { and, eq } from 'drizzle-orm';
import { newId } from '@class-pulse/domain';
import type { Db } from '../db/client';
import { invitations, roleAssignments, users } from '../db/schema';
import { audit } from '../services/audit';

/**
 * Identity comes from Clerk; authorization stays in our tables (scoped role assignments).
 * A Clerk user becomes a Class Pulse user in exactly two ways:
 *  1. they were invited by an administrator (an `invitations` row + a Clerk invitation email);
 *  2. they created a workspace through the sign-up flow (they become that org's administrator).
 * Anyone else authenticates fine but is "not provisioned" and sees only the onboarding screen.
 */
export interface Identity {
  subject: string;
  email: string | null;
  name: string | null;
}

export interface ClerkAuth {
  client: ClerkClient;
  verify(token: string): Promise<Identity | null>;
}

export function createClerkAuth(cfg: { publishableKey: string; secretKey: string }): ClerkAuth {
  const client = createClerkClient({ secretKey: cfg.secretKey, publishableKey: cfg.publishableKey });
  return {
    client,
    async verify(token: string): Promise<Identity | null> {
      try {
        const payload = await verifyToken(token, { secretKey: cfg.secretKey });
        // Session JWTs carry the subject; email/name are fetched lazily only during provisioning.
        return { subject: payload.sub, email: null, name: null };
      } catch {
        return null;
      }
    },
  };
}

/** Test seam: `Authorization: Test <userId>` is honoured only when NODE_ENV=test. */
export function createTestAuth(): ClerkAuth {
  return {
    client: null as unknown as ClerkClient,
    async verify() {
      return null;
    },
  };
}

export async function userBySubject(db: Db, subject: string) {
  const [row] = await db.select().from(users).where(eq(users.authSubject, subject)).limit(1);
  return row ?? null;
}

/**
 * First sign-in of an invited person: match the Clerk user's primary email (or the invitation id
 * Clerk copied into the user's public metadata) to a pending invitation, create the user row,
 * and materialize the role assignment the administrator chose at invite time.
 */
export async function provisionFromInvitation(db: Db, auth: ClerkAuth, subject: string) {
  const clerkUser = await auth.client.users.getUser(subject);
  const email = clerkUser.primaryEmailAddress?.emailAddress?.toLowerCase() ?? clerkUser.emailAddresses[0]?.emailAddress?.toLowerCase() ?? null;
  const invitationId = typeof clerkUser.publicMetadata?.invitationId === 'string' ? clerkUser.publicMetadata.invitationId : null;
  const displayName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ') || email || 'New user';

  let invitation = invitationId ? (await db.select().from(invitations).where(and(eq(invitations.id, invitationId), eq(invitations.status, 'pending'))).limit(1))[0] : undefined;
  if (!invitation && email) invitation = (await db.select().from(invitations).where(and(eq(invitations.email, email), eq(invitations.status, 'pending'))).limit(1))[0];

  // An existing user row created by an admin with a known email but no subject yet (e.g. seeded).
  const [existingByEmail] = email ? await db.select().from(users).where(eq(users.email, email)).limit(1) : [];
  if (existingByEmail && !existingByEmail.authSubject) {
    await db.update(users).set({ authSubject: subject }).where(eq(users.id, existingByEmail.id));
    if (invitation) await db.update(invitations).set({ status: 'accepted', acceptedAt: new Date(), userId: existingByEmail.id }).where(eq(invitations.id, invitation.id));
    return { ...existingByEmail, authSubject: subject };
  }
  if (!invitation) return null;

  const userId = newId();
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ id: userId, email: invitation.email, displayName, authSubject: subject });
    await tx.insert(roleAssignments).values({ id: newId(), userId, role: invitation.role, schoolId: invitation.schoolId, sectionId: invitation.sectionId, studentId: invitation.studentId });
    await tx.update(invitations).set({ status: 'accepted', acceptedAt: new Date(), userId }).where(eq(invitations.id, invitation.id));
  });
  await audit(db, { actorUserId: userId, actorRole: invitation.role as never, action: 'auth.login', targetType: 'invitation', targetId: invitation.id, metadata: { accepted: true } });
  const [row] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return row!;
}

export async function identityDetails(auth: ClerkAuth, subject: string): Promise<Identity> {
  const u = await auth.client.users.getUser(subject);
  const email = u.primaryEmailAddress?.emailAddress ?? u.emailAddresses[0]?.emailAddress ?? null;
  return { subject, email, name: [u.firstName, u.lastName].filter(Boolean).join(' ') || null };
}
