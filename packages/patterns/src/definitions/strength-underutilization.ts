import type { PatternDefinition } from '../engine/window';
import { fired, notFired } from '../engine/window';

const STOP = new Set(['the', 'and', 'with', 'when', 'well', 'works', 'enjoys', 'likes', 'responds', 'positive', 'student', 'into', 'divided', 'parts', 'smaller', 'assignments', 'good', 'very', 'strong']);

function tokens(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOP.has(w));
}

/**
 * docs/02: "cheap, positive in framing, immediately actionable, and pulls the plan's own
 * 'Student Strengths' section into the live loop. Good first rule to build."
 *
 * Fires when a documented strength is referenced by no active strategy — by explicit
 * `usesStrengths` link or by content-word overlap with a strategy description.
 */
export const strengthUnderutilization: PatternDefinition = {
  id: 'strength-underutilization',
  version: 1,
  title: 'Strength not yet used',
  plainLanguage: 'One of the strengths or interests written into this plan is not used by any of the strategies currently in place.',
  requiredSignals: { types: [], minObservations: 0, minDistinctDays: 0, minSpanDays: 0 },
  confounders: [
    'The strength may be used informally in ways that were never written into a strategy',
    'The strength may not be relevant to the target behavior or the setting where it occurs',
    'A strategy using it may have been tried and retired before this plan was approved',
  ],
  routing: 'teacher_review',
  suppression: { cooldownDays: 30, maxActivePerStudent: 1 },
  status: 'active',
  thresholds: { minOverlapWords: 1 },
  reviewer: null,
  proxyReview: 'Uses only the plan text (strengths and strategies). No signal data, no attendance, no grades, nothing correlated with protected characteristics.',
  detect(ctx) {
    const plan = ctx.plan;
    if (!plan || plan.strengths.length === 0) return notFired({ strengths: 0 });
    const active = plan.strategies.filter((s) => s.status === 'active');
    if (active.length === 0) return notFired({ strengths: plan.strengths.length, activeStrategies: 0 });
    const unused: string[] = [];
    for (const strength of plan.strengths) {
      const words = tokens(strength);
      const used = active.some((s) => {
        if (s.usesStrengths.some((u) => u.toLowerCase().trim() === strength.toLowerCase().trim())) return true;
        const hay = `${s.description} ${s.usesStrengths.join(' ')}`.toLowerCase();
        const hits = words.filter((w) => hay.includes(w)).length;
        return words.length > 0 && hits >= Math.max(this.thresholds.minOverlapWords!, Math.ceil(words.length / 2));
      });
      if (!used) unused.push(strength);
    }
    const measures = { strengths: plan.strengths.length, activeStrategies: active.length, unusedStrengths: unused.length, firstUnusedIndex: unused.length ? plan.strengths.indexOf(unused[0]!) : -1 };
    if (unused.length === 0) return notFired(measures);
    return fired(0.4 + 0.6 * (unused.length / plan.strengths.length), [], measures);
  },
};
