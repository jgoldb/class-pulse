import { z } from 'zod';

const text = z.string().trim().min(1).max(2000);
export const ContributionContent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reflection'), whatHappened: text, whatHelped: z.string().trim().max(2000) }).strict(),
  z.object({ kind: z.literal('proposal'), proposedChange: text, reason: text }).strict(),
  z.object({ kind: z.literal('strategy_choice'), strategyId: z.string().min(1), experience: text }).strict(),
  z.object({ kind: z.literal('family_observation'), observation: text, context: z.string().trim().max(1000) }).strict(),
  z.object({ kind: z.literal('home_strategy'), strategy: text, observedOutcome: text }).strict(),
  z.object({ kind: z.literal('homework'), observation: text, whatHelped: z.string().trim().max(2000) }).strict(),
]);
export type ContributionContent = z.infer<typeof ContributionContent>;
export const SubmitContribution = z.object({ requestId: z.string().uuid(), studentId: z.string().min(1), sectionId: z.string().min(1), recipientId: z.string().min(1), role: z.enum(['student', 'guardian']), content: ContributionContent }).strict();
export type SubmitContribution = z.infer<typeof SubmitContribution>;
export const RespondContribution = z.object({ expectedRevision: z.number().int().positive(), decision: z.enum(['acknowledged', 'accepted', 'declined']), response: text }).strict();
export type RespondContribution = z.infer<typeof RespondContribution>;
export const CorrectContribution = z.object({ requestId: z.string().uuid(), expectedRevision: z.number().int().positive(), content: ContributionContent }).strict();
export type CorrectContribution = z.infer<typeof CorrectContribution>;
