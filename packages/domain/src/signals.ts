import { z } from 'zod';

/**
 * docs/01 — the signal layer. Everything measurable normalizes into one shape so that the
 * pattern engine can compare behavior, grades, attendance and assessments.
 */
export const SIGNAL_TYPES = [
  'behavior_event',
  'assignment_grade',
  'assessment_score',
  'attendance',
  'strategy_use',
  'self_check',
  'interval_observation',
] as const;
export const SignalType = z.enum(SIGNAL_TYPES);
export type SignalType = z.infer<typeof SignalType>;

export const SIGNAL_SOURCES = ['teacher_entry', 'student_entry', 'sis_import', 'system'] as const;
export const SignalSource = z.enum(SIGNAL_SOURCES);
export type SignalSource = z.infer<typeof SignalSource>;

export const SourceConfidence = z.enum(['high', 'medium', 'low']);
export type SourceConfidence = z.infer<typeof SourceConfidence>;

/**
 * Context tags are a controlled vocabulary (docs/01: "free-text tags would fragment and break
 * detection"). Organizations may extend it; extensions are validated against the org list at the
 * API boundary, not here.
 */
export const CONTEXT_DIMENSIONS = {
  work_arrangement: ['group_work', 'independent', 'paired', 'whole_class'],
  task_length: ['short_task', 'long_assignment', 'multi_day'],
  structure: ['structured', 'transition', 'unstructured_time'],
  assessment_type: ['formative', 'summative', 'performance_task'],
  schedule: [
    'period_1', 'period_2', 'period_3', 'period_4', 'period_5', 'period_6', 'period_7', 'period_8',
    'morning', 'afternoon',
  ],
} as const;
export type ContextDimension = keyof typeof CONTEXT_DIMENSIONS;

export const SEED_CONTEXT_TAGS = Object.values(CONTEXT_DIMENSIONS).flat() as readonly string[];

export function dimensionOfTag(tag: string): ContextDimension | null {
  for (const [dim, tags] of Object.entries(CONTEXT_DIMENSIONS)) {
    if ((tags as readonly string[]).includes(tag)) return dim as ContextDimension;
  }
  return null;
}

export const ContextTag = z
  .string()
  .regex(/^[a-z][a-z0-9_]{1,40}$/, 'context tags are lowercase snake_case identifiers');

/**
 * Per-type value coding. Kept explicit so detection rules can rely on it.
 *  - behavior_event: value = count (usually 1), unit = 'events'
 *  - assignment_grade / assessment_score: value = percent 0..100, unit = 'percent'
 *  - attendance: value = 1 present, 0 absent, 0.5 partial/tardy; unit = 'presence'
 *  - strategy_use: value = 1, unit = 'uses'; strategyId links the strategy
 *  - self_check: value = 1..5 self-rating, unit = 'rating'
 *  - interval_observation: value = percent of intervals with target behavior, unit = 'percent_intervals'
 */
export const SIGNAL_UNITS: Record<SignalType, string> = {
  behavior_event: 'events',
  assignment_grade: 'percent',
  assessment_score: 'percent',
  attendance: 'presence',
  strategy_use: 'uses',
  self_check: 'rating',
  interval_observation: 'percent_intervals',
};

export const Signal = z.object({
  id: z.string(),
  caseKey: z.string(),
  type: SignalType,
  value: z.union([z.number(), z.string()]),
  unit: z.string().optional(),
  contextTags: z.array(ContextTag),
  observedAt: z.coerce.date(),
  source: SignalSource,
  sourceConfidence: SourceConfidence,
  enteredBy: z.string().optional(),
  /** Optional link to a goal or strategy on the active plan. */
  goalId: z.string().nullable().optional(),
  strategyId: z.string().nullable().optional(),
  note: z.string().max(500).nullable().optional(),
});
export type Signal = z.infer<typeof Signal>;

export const NewSignal = Signal.omit({ id: true });
export type NewSignal = z.infer<typeof NewSignal>;

export function numericValue(s: Pick<Signal, 'value'>): number | null {
  if (typeof s.value === 'number') return Number.isFinite(s.value) ? s.value : null;
  const n = Number(s.value);
  return Number.isFinite(n) ? n : null;
}
