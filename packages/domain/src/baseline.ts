import { z } from 'zod';

/**
 * docs/01 — "Baseline is a discriminated union, not a nullable number." The source prompt's
 * central win was the model refusing to treat "3–5 times per period" as a baseline for either
 * of two behaviors. Persisting `number | null` would discard that reasoning.
 */
export const Baseline = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('available'),
    value: z.number(),
    unit: z.string(),
    observations: z.number().int().nonnegative(),
    spanDays: z.number().int().nonnegative(),
  }),
  z.object({
    status: z.literal('unavailable'),
    reason: z.string(),
  }),
  z.object({
    status: z.literal('ambiguous'),
    rawInput: z.string(),
    whyAmbiguous: z.string(),
    candidateBehaviors: z.array(z.string()),
  }),
]);
export type Baseline = z.infer<typeof Baseline>;

/**
 * A *proposed* target must be structurally distinct from an *established* one, and a target
 * that cannot be set until a baseline exists is its own state.
 */
export const GoalTarget = z.discriminatedUnion('status', [
  z.object({ status: z.literal('proposed'), value: z.number(), unit: z.string(), rationale: z.string() }),
  z.object({
    status: z.literal('established'),
    value: z.number(),
    unit: z.string(),
    establishedBy: z.string().nullable().optional(),
  }),
  z.object({ status: z.literal('blocked_on_baseline'), note: z.string() }),
]);
export type GoalTarget = z.infer<typeof GoalTarget>;

/** True when a numeric target exists without an available baseline — the V1 failure. */
export function targetWithoutBaseline(baseline: Baseline, target: GoalTarget): boolean {
  return target.status !== 'blocked_on_baseline' && baseline.status !== 'available';
}
