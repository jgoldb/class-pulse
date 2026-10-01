import { z } from 'zod';

const note = z.string().trim().max(2000);
const text = z.string().trim().min(1).max(500);
/** Missing evidence stays missing. Only an explicitly measured behavior has a count. */
export const ClassroomObservation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('participation'), action: z.enum(['contributed', 'asked_question', 'collaborated']), note }).strict(),
  z.object({ kind: z.literal('praise'), strength: text, note }).strict(),
  z.object({ kind: z.literal('understanding'), concept: text, evidence: z.enum(['demonstrated', 'needs_practice', 'not_checked']), note }).strict(),
  z.object({ kind: z.literal('check_in'), observation: text, note }).strict(),
  z.object({ kind: z.literal('behavior'), action: text, antecedent: note.nullable(), consequence: note.nullable(), measuredCount: z.number().int().min(0).max(10000).nullable(), note }).strict(),
  z.object({ kind: z.literal('attendance'), status: z.enum(['present', 'absent', 'late']), note }).strict(),
  z.object({ kind: z.literal('exit_ticket'), concept: text, response: text, assessment: z.enum(['demonstrated', 'needs_practice', 'not_assessed']), note }).strict(),
]);
export type ClassroomObservation = z.infer<typeof ClassroomObservation>;
export const CaptureEvent = z.object({
  requestId: z.string().uuid(), sessionId: z.string().uuid(), studentId: z.string().min(1),
  source: z.enum(['teacher_tap', 'teacher_text', 'reviewed_transcript']),
  observedAt: z.string().datetime({ offset: true }), observation: ClassroomObservation,
  confirmed: z.boolean(),
}).strict();
export type CaptureEvent = z.infer<typeof CaptureEvent>;
export const ReviseEvent = z.object({
  requestId: z.string().uuid(), expectedRevision: z.number().int().positive(),
  studentId: z.string().min(1), observation: ClassroomObservation,
  reason: z.string().trim().min(1).max(500), confirmed: z.boolean(),
}).strict();
export type ReviseEvent = z.infer<typeof ReviseEvent>;
export const SessionInput = z.object({
  requestId: z.string().uuid(), sectionId: z.string().min(1), date: z.iso.date(),
  topic: z.string().trim().max(500), objective: z.string().trim().max(1000),
  contextTags: z.array(z.string().trim().min(1).max(80)).max(20),
}).strict();
export type SessionInput = z.infer<typeof SessionInput>;
export const SeatingInput = z.object({
  expectedVersion: z.number().int().min(0),
  positions: z.array(z.object({ studentId: z.string(), row: z.number().int().min(0).max(19), column: z.number().int().min(0).max(19) }).strict()).max(200),
}).strict().superRefine(({ positions }, ctx) => {
  if (new Set(positions.map((p) => p.studentId)).size !== positions.length || new Set(positions.map((p) => `${p.row}:${p.column}`)).size !== positions.length) {
    ctx.addIssue({ code: 'custom', message: 'Each student and seat must appear only once' });
  }
});
export type SeatingInput = z.infer<typeof SeatingInput>;
