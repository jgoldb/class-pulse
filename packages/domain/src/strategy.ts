import { z } from 'zod';

export const STRATEGY_KINDS = ['preventive', 'response', 'replacement', 'self_monitor', 'family'] as const;
export const StrategyKind = z.enum(STRATEGY_KINDS);
export type StrategyKind = z.infer<typeof StrategyKind>;

export const EffortLevel = z.enum(['low', 'medium', 'high']);
export type EffortLevel = z.infer<typeof EffortLevel>;

export const StrategyContent = z.object({
  description: z.string().min(1),
  rationale: z.string(),
  /** Which documented strengths/interests this strategy leans on. Drives strength-underutilization. */
  usesStrengths: z.array(z.string()),
  effortLevel: EffortLevel,
});
export type StrategyContent = z.infer<typeof StrategyContent>;

export const Strategy = StrategyContent.extend({
  id: z.string(),
  planId: z.string(),
  kind: StrategyKind,
  status: z.enum(['draft', 'active', 'retired']),
});
export type Strategy = z.infer<typeof Strategy>;
