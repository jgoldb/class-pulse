import { z } from 'zod';
export const PlanRevisionSource = z.object({ kind: z.enum(['event', 'contribution']), id: z.string().uuid(), revision: z.number().int().positive() }).strict();
export type PlanRevisionSource = z.infer<typeof PlanRevisionSource>;
export const RequestPlanRevision = z.object({
  requestId: z.string().uuid(), caseKey: z.string().min(1), basePlanId: z.string().min(1),
  sources: z.array(PlanRevisionSource).min(1).max(30),
  strategySection: z.enum(['preventiveStrategies', 'teacherResponseStrategies', 'studentSelfMonitoring', 'parentGuardianSupport']),
  description: z.string().trim().min(1).max(2000), rationale: z.string().trim().min(1).max(2000),
}).strict().superRefine((v, ctx) => { if (new Set(v.sources.map((s) => `${s.kind}:${s.id}`)).size !== v.sources.length) ctx.addIssue({ code: 'custom', message: 'Duplicate revision source' }); });
export type RequestPlanRevision = z.infer<typeof RequestPlanRevision>;
