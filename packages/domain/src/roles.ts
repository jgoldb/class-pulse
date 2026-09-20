import { z } from 'zod';

export const ROLES = ['teacher', 'student', 'guardian', 'support_professional', 'administrator'] as const;
export const Role = z.enum(ROLES);
export type Role = z.infer<typeof Role>;

/**
 * docs/04: roles are *scoped*, never global. A teacher's role is per-section, a guardian's is
 * per-child, a support professional's is per-assigned-student, an administrator's is per-school.
 * Exactly one scope field is set per assignment; the API validates that.
 */
export const RoleAssignment = z.object({
  id: z.string(),
  userId: z.string(),
  role: Role,
  schoolId: z.string().nullable(),
  sectionId: z.string().nullable(),
  studentId: z.string().nullable(),
});
export type RoleAssignment = z.infer<typeof RoleAssignment>;

export function roleScopeIsValid(a: Pick<RoleAssignment, 'role' | 'schoolId' | 'sectionId' | 'studentId'>): boolean {
  switch (a.role) {
    case 'teacher':
      return !!a.sectionId && !a.studentId;
    case 'student':
    case 'guardian':
    case 'support_professional':
      return !!a.studentId && !a.sectionId;
    case 'administrator':
      return !!a.schoolId && !a.sectionId && !a.studentId;
  }
}

/** Individual administrative access requires an explicit, time-boxed record (docs/04). */
export const AuthorizationRecord = z.object({
  id: z.string(),
  adminUserId: z.string(),
  studentId: z.string(),
  grantedByUserId: z.string(),
  reason: z.string().min(5),
  grantedAt: z.coerce.date(),
  expiresAt: z.coerce.date(),
  revokedAt: z.coerce.date().nullable(),
});
export type AuthorizationRecord = z.infer<typeof AuthorizationRecord>;

export const AUDIT_ACTIONS = [
  'student.read',
  'student.list',
  'plane.join',
  'egress.call',
  'authorization.grant',
  'authorization.revoke',
  'plan.transition',
  'plan.approve',
  'candidate.adjudicate',
  'review.decide',
  'intake.create',
  'signal.create',
  'safety.flag',
  'correction.request',
  'definition.status',
  'prompt.promote',
  'auth.login',
] as const;
export const AuditAction = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditAction>;

export const AuditEvent = z.object({
  id: z.string(),
  actorUserId: z.string().nullable(),
  actorRole: Role.nullable(),
  action: AuditAction,
  targetType: z.string(),
  targetId: z.string().nullable(),
  caseKey: z.string().nullable(),
  studentId: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  at: z.coerce.date(),
});
export type AuditEvent = z.infer<typeof AuditEvent>;
