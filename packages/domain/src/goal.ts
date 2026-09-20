import { z } from 'zod';
import { Baseline, GoalTarget } from './baseline';

export const MEASUREMENT_METHODS = ['frequency_count', 'interval_observation', 'duration', 'permanent_product'] as const;
export const MeasurementMethod = z.enum(MEASUREMENT_METHODS);
export type MeasurementMethod = z.infer<typeof MeasurementMethod>;

export const GOAL_STATUSES = ['draft', 'active', 'met', 'modified', 'faded', 'discontinued'] as const;
export const GoalStatus = z.enum(GOAL_STATUSES);
export type GoalStatus = z.infer<typeof GoalStatus>;

/** Direction of improvement for the measured value. */
export const GoalDirection = z.enum(['decrease', 'increase']);
export type GoalDirection = z.infer<typeof GoalDirection>;

/** The AI-facing goal shape: everything except persistence ids. */
export const GoalContent = z.object({
  targetBehavior: z.string().min(1),
  observableDefinition: z.string().min(1),
  baseline: Baseline,
  measurementMethod: MeasurementMethod,
  direction: GoalDirection,
  target: GoalTarget,
  reviewPeriodDays: z.number().int().min(7).max(90),
});
export type GoalContent = z.infer<typeof GoalContent>;

export const Goal = GoalContent.extend({
  id: z.string(),
  planId: z.string(),
  status: GoalStatus,
  createdAt: z.coerce.date().optional(),
});
export type Goal = z.infer<typeof Goal>;

/** Terms the source prompt forbids in observable definitions. Flagged by guardrails, not the schema. */
export const VAGUE_TERMS = [
  'focused',
  'engaged',
  'on task',
  'on-task',
  'appropriate',
  'respectful',
  'good behavior',
  'disruptive',
  'attentive',
  'motivated',
] as const;

export function vagueTermsIn(text: string): string[] {
  const lower = text.toLowerCase();
  return VAGUE_TERMS.filter((t) => {
    const escaped = t.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    return new RegExp(`(^|[^a-z])${escaped}([^a-z]|$)`).test(lower);
  });
}

/** Which signal type carries this goal's measurement. */
export function signalTypeForMethod(method: MeasurementMethod) {
  switch (method) {
    case 'frequency_count':
      return 'behavior_event' as const;
    case 'interval_observation':
      return 'interval_observation' as const;
    case 'duration':
      return 'behavior_event' as const;
    case 'permanent_product':
      return 'assignment_grade' as const;
  }
}
