import { z } from 'zod';

export const CreateFollowUp = z.object({
  requestId: z.string().uuid(), draftId: z.string().uuid(), artifactRevision: z.number().int().positive(),
  kind: z.enum(['follow_up', 'intervention_review']), title: z.string().trim().min(1).max(200),
  action: z.string().trim().min(1).max(2000), dueDate: z.iso.date(), confirmed: z.literal(true),
}).strict();
export type CreateFollowUp = z.infer<typeof CreateFollowUp>;
export const UpdateFollowUp = z.object({ expectedRevision: z.number().int().positive(), status: z.enum(['completed', 'cancelled']) }).strict();
export type UpdateFollowUp = z.infer<typeof UpdateFollowUp>;
