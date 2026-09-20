import type { PatternDefinition } from '../engine/window';
import { fired, insufficient, notFired } from '../engine/window';

/**
 * docs/02: "non-response-trajectory *is* the review cycle's 'modify' decision." It reads the
 * computed summaries of past review cycles (same engine, same signal store) and fires when two
 * or more cycles show consistent implementation with no improvement.
 */
export const nonResponseTrajectory: PatternDefinition = {
  id: 'non-response-trajectory',
  version: 1,
  title: 'No response across review cycles',
  plainLanguage: 'Strategies have been used consistently through at least two review cycles, and the goal measures have not improved or have worsened.',
  requiredSignals: { types: [], minObservations: 0, minDistinctDays: 0, minSpanDays: 0 },
  confounders: [
    'Logging may have been consistent but the strategy itself may not have been delivered as written',
    'The measured behavior may have changed in ways the current goal definition does not capture',
    'External changes (schedule, seating, staffing) across the cycles may explain the trajectory',
  ],
  routing: 'support_team',
  suppression: { cooldownDays: 45, maxActivePerStudent: 1 },
  status: 'piloting',
  thresholds: { minCycles: 2, minImplementationShare: 0.6 },
  reviewer: null,
  proxyReview: 'Uses only the plan\'s own review-cycle computations. No demographic or attendance input.',
  detect(ctx) {
    const decided = ctx.reviewCycles.filter((c) => c.computed && c.decision && c.decision !== 'fade');
    if (decided.length < this.thresholds.minCycles!) return insufficient([`${this.thresholds.minCycles! - decided.length} more completed review cycle(s)`]);
    const recent = decided.slice(-this.thresholds.minCycles!);
    let consistent = 0;
    let nonImproving = 0;
    for (const c of recent) {
      const ic = c.computed!.implementationConsistency;
      const share = ic.weeksInWindow > 0 ? ic.weeksWithStrategyUse / ic.weeksInWindow : 0;
      if (share >= this.thresholds.minImplementationShare!) consistent++;
      const goals = c.computed!.goalSummaries.filter((g) => g.trend !== 'insufficient_data');
      if (goals.length > 0 && goals.every((g) => g.trend !== 'improving')) nonImproving++;
    }
    const measures = { cyclesConsidered: recent.length, cyclesWithConsistentImplementation: consistent, cyclesWithoutImprovement: nonImproving };
    if (consistent < recent.length || nonImproving < recent.length) return notFired(measures);
    return fired(0.6 + 0.4 * Math.min(1, (decided.length - 2) / 2), [], measures);
  },
};
