import { z } from 'zod';

/**
 * Section 14 of the plan ("Plan Review and Revision Criteria") as rules, not prose (docs/03).
 * The review-cycle engine evaluates these against logged data and computes the recommendation;
 * the model narrates a computed result and never makes the call.
 */
export const REVIEW_DECISIONS = ['continue', 'modify', 'collect_more', 'seek_support', 'fade'] as const;
export const ReviewDecision = z.enum(REVIEW_DECISIONS);
export type ReviewDecision = z.infer<typeof ReviewDecision>;

export const REVIEW_METRICS = [
  'events_per_day',
  'percent_intervals',
  'mean_grade_percent',
  'strategy_uses_per_week',
  'self_check_mean',
] as const;
export const ReviewMetric = z.enum(REVIEW_METRICS);
export type ReviewMetric = z.infer<typeof ReviewMetric>;

export const ReviewCriterion = z.object({
  /** Index into measurableGoals, or null for plan-wide criteria */
  goalIndex: z.number().int().nonnegative().nullable(),
  description: z.string().min(1),
  metric: ReviewMetric,
  comparator: z.enum(['lte', 'gte', 'change_pct_lte', 'change_pct_gte', 'insufficient_data']),
  /** Absolute threshold or percent change vs. baseline depending on comparator; null for insufficient_data */
  value: z.number().nullable(),
  windowDays: z.number().int().min(5).max(90),
  /** Minimum observations in the window before this criterion can fire */
  minObservations: z.number().int().min(1).max(100),
  decision: ReviewDecision,
});
export type ReviewCriterion = z.infer<typeof ReviewCriterion>;

export const REVIEW_CYCLE_STATUSES = ['scheduled', 'open', 'decided', 'skipped'] as const;
export const ReviewCycleStatus = z.enum(REVIEW_CYCLE_STATUSES);
export type ReviewCycleStatus = z.infer<typeof ReviewCycleStatus>;

/** The deterministic output of the review-cycle engine, before any narration. */
export const ComputedRecommendation = z.object({
  decision: ReviewDecision,
  firedCriteria: z.array(
    z.object({
      criterionIndex: z.number().int(),
      description: z.string(),
      observedValue: z.number().nullable(),
      observations: z.number().int(),
      decision: ReviewDecision,
    }),
  ),
  goalSummaries: z.array(
    z.object({
      goalIndex: z.number().int(),
      targetBehavior: z.string(),
      observations: z.number().int(),
      windowDays: z.number().int(),
      currentValue: z.number().nullable(),
      baselineValue: z.number().nullable(),
      changePct: z.number().nullable(),
      trend: z.enum(['improving', 'flat', 'worsening', 'insufficient_data']),
    }),
  ),
  implementationConsistency: z.object({
    strategyUsesInWindow: z.number().int(),
    weeksWithStrategyUse: z.number().int(),
    weeksInWindow: z.number().int(),
  }),
  rationale: z.array(z.string()),
});
export type ComputedRecommendation = z.infer<typeof ComputedRecommendation>;

/** The model narrates the computed recommendation. Guardrail: `decision` must equal the computed one. */
export const ReviewNarrative = z.object({
  decision: ReviewDecision,
  summaryForTeacher: z.string().min(1),
  summaryForStudent: z.string().min(1),
  summaryForFamily: z.string().min(1),
  suggestedAdjustments: z.array(z.string()),
  humanReviewNotes: z.string(),
});
export type ReviewNarrative = z.infer<typeof ReviewNarrative>;

export const ReviewCycle = z.object({
  id: z.string(),
  planId: z.string(),
  dueAt: z.coerce.date(),
  status: ReviewCycleStatus,
  computed: ComputedRecommendation.nullable(),
  narrative: ReviewNarrative.nullable(),
  decision: ReviewDecision.nullable(),
  rationale: z.string().nullable(),
  reviewerUserId: z.string().nullable(),
  decidedAt: z.coerce.date().nullable(),
});
export type ReviewCycle = z.infer<typeof ReviewCycle>;
