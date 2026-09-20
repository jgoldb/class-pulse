import { and, desc, eq, gte, type SQL } from 'drizzle-orm';
import { newId, type AuditAction, type Role } from '@class-pulse/domain';
import type { Db } from '../db/client';
import { auditEvents } from '../db/schema';

export interface AuditInput {
  actorUserId: string | null;
  actorRole: Role | 'administrator_authorized' | null;
  action: AuditAction;
  targetType: string;
  targetId?: string | null;
  caseKey?: string | null;
  studentId?: string | null;
  metadata?: Record<string, unknown>;
}

/** Append-only audit (docs/04). The DB trigger rejects updates; this module only inserts and reads. */
export async function audit(db: Db, e: AuditInput): Promise<void> {
  await db.insert(auditEvents).values({
    id: newId(),
    actorUserId: e.actorUserId,
    actorRole: e.actorRole,
    action: e.action,
    targetType: e.targetType,
    targetId: e.targetId ?? null,
    caseKey: e.caseKey ?? null,
    studentId: e.studentId ?? null,
    metadata: e.metadata ?? {},
  });
}

export async function listAudit(db: Db, filter: { studentId?: string; caseKey?: string; action?: AuditAction; since?: Date; limit?: number }) {
  const conds: SQL[] = [];
  if (filter.studentId) conds.push(eq(auditEvents.studentId, filter.studentId));
  if (filter.caseKey) conds.push(eq(auditEvents.caseKey, filter.caseKey));
  if (filter.action) conds.push(eq(auditEvents.action, filter.action));
  if (filter.since) conds.push(gte(auditEvents.at, filter.since));
  return db
    .select()
    .from(auditEvents)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditEvents.at))
    .limit(filter.limit ?? 200);
}
