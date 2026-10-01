import { and, desc, eq, isNull } from 'drizzle-orm';
import { newId } from '@class-pulse/domain';
import type { Actor, AppContext } from '../context';
import { badRequest, conflict, forbidden } from '../context';
import { sectionEnrollments, students, voiceApprovals } from '../db/schema';
import { audit } from './audit';
import { requirePulse } from './pulse';

/** A short, deliberate voice note: no background recording, at most a minute. */
export const VOICE_LIMITS = { maxBytes: 2_500_000, maxSeconds: 60, mimeTypes: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'] };

async function approvalFor(ctx: AppContext, schoolId: string) {
  const [row] = await ctx.db.select().from(voiceApprovals).where(and(eq(voiceApprovals.schoolId, schoolId), isNull(voiceApprovals.revokedAt))).orderBy(desc(voiceApprovals.recordedAt)).limit(1);
  return row ?? null;
}

/** Whether voice is available in this class, and if not, the plain reason. */
export async function voiceStatus(ctx: AppContext, actor: Actor, sectionId: string) {
  const section = await requirePulse(ctx, actor, sectionId);
  const approval = await approvalFor(ctx, section.schoolId);
  if (!approval) return { enabled: false, reason: 'Voice capture turns on once your school approves an audio transcription provider. Nothing is recorded until then.', approval: null };
  if (ctx.aiConfig.provider === 'off') return { enabled: false, reason: 'AI features are turned off for this deployment, so voice notes cannot be transcribed. Type the observation instead.', approval: null };
  return { enabled: true, reason: '', approval: { provider: approval.provider, approvedBy: `${approval.approvedByName}, ${approval.approvedByTitle}`, policyReference: approval.policyReference, recordedAt: approval.recordedAt }, limits: { maxSeconds: VOICE_LIMITS.maxSeconds } };
}

/**
 * Transcribe one voice note for review. The audio lives only in this request; the transcript is
 * returned to the teacher and saved only if they confirm it as an observation. Speaker
 * identification is never attempted: the teacher selects the student.
 */
export async function transcribeVoice(ctx: AppContext, actor: Actor, sectionId: string, audio: Buffer, mimeType: string) {
  const status = await voiceStatus(ctx, actor, sectionId);
  if (!status.enabled) throw conflict(status.reason);
  const type = mimeType.split(';')[0]!.trim();
  if (!VOICE_LIMITS.mimeTypes.includes(type)) throw badRequest('Unsupported audio format');
  if (!audio.length || audio.length > VOICE_LIMITS.maxBytes) throw badRequest('Voice notes must be under a minute');
  const roster = await ctx.db.select({ first: students.firstName, last: students.lastName }).from(students).innerJoin(sectionEnrollments, eq(sectionEnrollments.studentId, students.id)).where(eq(sectionEnrollments.sectionId, sectionId));
  const result = await ctx.gate.transcribe({ audio, mimeType: type, model: ctx.aiConfig.transcribeModel, language: 'en', denyNames: roster.flatMap((s) => [s.first, s.last, `${s.first} ${s.last}`]) });
  await audit(ctx.db, { actorUserId: actor.userId, actorRole: 'teacher', action: 'voice.transcribe', targetType: 'section', targetId: sectionId, metadata: { bytes: audio.length, ok: result.ok, runId: result.runId, namesFlagged: result.ok ? result.piiWarnings.length : 0 } });
  if (!result.ok) throw conflict(result.error);
  return { transcript: result.text, flagged: result.piiWarnings.map((w) => ({ start: w.start, end: w.end, kind: w.kind })) };
}

export async function listVoiceApprovals(ctx: AppContext, actor: Actor) {
  const ids = [...actor.scope.adminSchoolIds];
  const result = [];
  for (const schoolId of ids) result.push({ schoolId, approval: await approvalFor(ctx, schoolId) });
  return result;
}

/** Recorded by an administrator on behalf of the school official who approved the provider. */
export async function setVoiceApproval(ctx: AppContext, actor: Actor, input: { schoolId: string; approved: boolean; provider?: string; approvedByName?: string; approvedByTitle?: string; policyReference?: string }) {
  if (!actor.scope.adminSchoolIds.has(input.schoolId)) throw forbidden('School is outside your administration');
  if (input.approved && (!input.provider || !input.approvedByName || !input.approvedByTitle || !input.policyReference)) throw badRequest('Name the provider, the approving official and the policy reference');
  await ctx.db.transaction(async (tx) => {
    await tx.update(voiceApprovals).set({ revokedAt: ctx.now() }).where(and(eq(voiceApprovals.schoolId, input.schoolId), isNull(voiceApprovals.revokedAt)));
    if (input.approved) await tx.insert(voiceApprovals).values({ id: newId(), schoolId: input.schoolId, provider: input.provider!, approvedByName: input.approvedByName!, approvedByTitle: input.approvedByTitle!, policyReference: input.policyReference!, recordedBy: actor.userId, recordedAt: ctx.now() });
    await audit(tx, { actorUserId: actor.userId, actorRole: 'administrator', action: 'voice.approve', targetType: 'school', targetId: input.schoolId, metadata: { approved: input.approved, provider: input.provider ?? null } });
  });
  return { approval: await approvalFor(ctx, input.schoolId) };
}
