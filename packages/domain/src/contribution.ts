import { z } from 'zod';

const text = z.string().trim().min(1).max(2000);
export const ContributionContent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reflection'), whatHappened: text, whatHelped: z.string().trim().max(2000) }).strict(),
  z.object({ kind: z.literal('proposal'), proposedChange: text, reason: text }).strict(),
  z.object({ kind: z.literal('strategy_choice'), strategyId: z.string().min(1), experience: text }).strict(),
  z.object({ kind: z.literal('family_observation'), observation: text, context: z.string().trim().max(1000) }).strict(),
  z.object({ kind: z.literal('home_strategy'), strategy: text, observedOutcome: text }).strict(),
  z.object({ kind: z.literal('homework'), observation: text, whatHelped: z.string().trim().max(2000) }).strict(),
  // Family-reported wellbeing, collected only where the school's policy allows (schools.family_wellbeing_collection).
  z.object({ kind: z.literal('sleep'), quality: z.enum(['rested', 'somewhat_tired', 'very_tired', 'not_sure']), hours: z.number().min(0).max(16).nullable(), note: z.string().trim().max(1000) }).strict(),
  z.object({ kind: z.literal('mood'), description: text, note: z.string().trim().max(1000) }).strict(),
]);
export const WELLBEING_KINDS = ['sleep', 'mood'] as const;
/** Who besides the selected teacher may see a family contribution. The author always can. */
export const ContributionVisibility = z.enum(['teacher', 'teacher_and_student']);
export type ContributionVisibility = z.infer<typeof ContributionVisibility>;
export type ContributionContent = z.infer<typeof ContributionContent>;
export const SubmitContribution = z.object({ requestId: z.string().uuid(), studentId: z.string().min(1), sectionId: z.string().min(1), recipientId: z.string().min(1), role: z.enum(['student', 'guardian']), content: ContributionContent, visibility: ContributionVisibility.default('teacher') }).strict();
export type SubmitContribution = z.infer<typeof SubmitContribution>;
export const RespondContribution = z.object({ expectedRevision: z.number().int().positive(), decision: z.enum(['acknowledged', 'accepted', 'declined']), response: text }).strict();
export type RespondContribution = z.infer<typeof RespondContribution>;
export const CorrectContribution = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().positive(), content: ContributionContent }).strict();
export type CorrectContribution = z.infer<typeof CorrectContribution>;
