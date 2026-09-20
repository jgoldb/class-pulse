import { z } from 'zod';

export const CASE_STATUSES = ['open', 'closed'] as const;
export const CaseStatus = z.enum(CASE_STATUSES);
export type CaseStatus = z.infer<typeof CaseStatus>;

/** Working-plane case, keyed only by a pseudonymous caseKey (docs/04). No name, no student id. */
export const Case = z.object({
  caseKey: z.string(),
  gradeLevel: z.string(),
  status: CaseStatus,
  /** Section the case is attached to; used for teacher row scope without joining the identified plane. */
  sectionId: z.string(),
  schoolId: z.string(),
  createdAt: z.coerce.date(),
});
export type Case = z.infer<typeof Case>;

export const SAFETY_FLAG_STATUSES = ['open', 'acknowledged', 'closed'] as const;
export const SafetyFlag = z.object({
  id: z.string(),
  caseKey: z.string(),
  source: z.enum(['plan_generation', 'pattern_engine', 'teacher', 'student_self_check']),
  description: z.string(),
  status: z.enum(SAFETY_FLAG_STATUSES),
  createdAt: z.coerce.date(),
  acknowledgedBy: z.string().nullable(),
});
export type SafetyFlag = z.infer<typeof SafetyFlag>;

/** Family dispute / correction pathway (docs/04 transparency). */
export const CorrectionRequest = z.object({
  id: z.string(),
  caseKey: z.string(),
  requestedByUserId: z.string(),
  subject: z.string().min(1),
  detail: z.string().min(1),
  status: z.enum(['open', 'resolved']),
  resolutionNote: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type CorrectionRequest = z.infer<typeof CorrectionRequest>;
