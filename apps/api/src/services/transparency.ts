import { desc, eq, inArray } from 'drizzle-orm';
import { newId } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { badRequest, forbidden, notFound } from '../context';
import { correctionRequests } from '../db/schema';
import { audit } from './audit';
import { requireTeacherLike, roleForCase } from './cases';

/** docs/04 "Student and family transparency": an accessible correction path when a family disputes recorded information. */
export async function requestCorrection(ctx: AppContext, actor: Actor, caseKey: string, input: { subject: string; detail: string }) {
  const role = roleForCase(actor, caseKey);
  if (role !== 'guardian' && role !== 'student') throw forbidden('Correction requests come from families and students');
  if (!input.subject?.trim() || !input.detail?.trim()) throw badRequest('Subject and detail are required');
  const id = newId();
  await ctx.db.insert(correctionRequests).values({ id, caseKey, requestedByUserId: actor.userId, subject: input.subject.trim(), detail: input.detail.trim(), status: 'open' });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'correction.request', targetType: 'correction_request', targetId: id, caseKey });
  return id;
}

export async function openCorrectionsForActor(ctx: AppContext, actor: Actor) {
  const keys = [...actor.scope.caseRoles.entries()].filter(([, r]) => r === 'teacher' || r === 'support_professional').map(([k]) => k);
  if (!keys.length) return [];
  return ctx.db.select().from(correctionRequests).where(inArray(correctionRequests.caseKey, keys)).orderBy(desc(correctionRequests.createdAt));
}

export async function resolveCorrection(ctx: AppContext, actor: Actor, id: string, resolutionNote: string) {
  const [row] = await ctx.db.select().from(correctionRequests).where(eq(correctionRequests.id, id)).limit(1);
  if (!row) throw notFound('Correction request not found');
  const role = requireTeacherLike(actor, row.caseKey);
  await ctx.db.update(correctionRequests).set({ status: 'resolved', resolutionNote }).where(eq(correctionRequests.id, id));
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: role, action: 'correction.request', targetType: 'correction_request', targetId: id, caseKey: row.caseKey, metadata: { resolved: true } });
}
