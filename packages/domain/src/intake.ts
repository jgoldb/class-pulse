import { z } from 'zod';

/**
 * The 7 educator fields from the source prompt's "reusable educator input format"
 * (docs/appendix-a). Free text is size-capped; PII is scanned at the keyboard and again at the
 * egress gate (docs/04), never trusted to the prompt.
 */
export const IntakeFields = z.object({
  gradeLevel: z.string().min(1).max(20),
  observableBehavior: z.string().min(10).max(3000),
  baselineInformation: z.string().max(2000),
  documentedPatterns: z.string().max(2000),
  strengthsInterests: z.string().max(2000),
  currentStrategies: z.string().max(2000),
  desiredBehavior: z.string().min(5).max(2000),
});
export type IntakeFields = z.infer<typeof IntakeFields>;

export const INTAKE_FIELD_LABELS: Record<keyof IntakeFields, string> = {
  gradeLevel: 'Grade level',
  observableBehavior: 'Observable behavior',
  baselineInformation: 'Available baseline or frequency information',
  documentedPatterns: 'Documented situations or patterns',
  strengthsInterests: 'Student strengths/interests',
  currentStrategies: 'Current strategies',
  desiredBehavior: 'Desired behavior',
};

export const Intake = z.object({
  id: z.string(),
  caseKey: z.string(),
  version: z.number().int().positive(),
  fields: IntakeFields,
  createdBy: z.string(),
  createdAt: z.coerce.date(),
});
export type Intake = z.infer<typeof Intake>;
