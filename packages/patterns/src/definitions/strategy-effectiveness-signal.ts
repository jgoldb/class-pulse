import type { PatternDefinition } from '../engine/window';
import { checkSufficiency, dayKey, fired, insufficient, notFired, ofType } from '../engine/window';

/**
 * A logged strategy associates with improved immediate outcomes: days on which a strategy was
 * logged carry fewer behavior events than days on which none was.
 */
export const strategyEffectivenessSignal: PatternDefinition = {
  id: 'strategy-effectiveness-signal',
  version: 1,
  title: 'A strategy may be helping',
  plainLanguage: 'On days when a strategy was logged as used, fewer behavior events were recorded than on days when no strategy was logged.',
  requiredSignals: { types: ['behavior_event', 'strategy_use'], minObservations: 12, minDistinctDays: 8, minSpanDays: 14 },
  confounders: [
    'Strategies may be used more on days that were already going well',
    'Teachers may log events less carefully on days they are focused on using a strategy',
    'Days without strategy use may differ in schedule or task type',
    'A small number of days can swing the comparison',
  ],
  routing: 'teacher_review',
  suppression: { cooldownDays: 30, maxActivePerStudent: 1 },
  status: 'piloting',
  thresholds: { minDaysEach: 4, maxRatio: 0.5, minEventsWithout: 6 },
  reviewer: null,
  proxyReview: 'Within-student day comparison of the plan\'s own strategy log. Positive framing.',
  detect(ctx) {
    const missing = checkSufficiency(this, ctx.window.signals);
    if (missing.length) return insufficient(missing);
    const events = ofType(ctx.window.signals, ['behavior_event']);
    const uses = ofType(ctx.window.signals, ['strategy_use']);
    if (uses.length < this.thresholds.minDaysEach!) return insufficient([`${this.thresholds.minDaysEach! - uses.length} more strategy-use entries`]);
    const useDays = new Set(uses.map((s) => dayKey(s.observedAt)));
    // A day counts as observed if ANYTHING was logged (attendance, grades, a self-check...).
    // Using only event/use days would make "days without a strategy" mean "days with an event".
    const observedDays = new Set(ctx.window.signals.map((s) => dayKey(s.observedAt)));
    const withUse = [...observedDays].filter((d) => useDays.has(d));
    const without = [...observedDays].filter((d) => !useDays.has(d));
    if (withUse.length < this.thresholds.minDaysEach! || without.length < this.thresholds.minDaysEach!) {
      return insufficient([`at least ${this.thresholds.minDaysEach} observed days with a strategy logged and ${this.thresholds.minDaysEach} without (have ${withUse.length} / ${without.length})`]);
    }
    const countOn = (days: string[]) => events.filter((e) => days.includes(dayKey(e.observedAt))).length / days.length;
    const rateWith = countOn(withUse);
    const rateWithout = countOn(without);
    const ratio = rateWithout > 0 ? rateWith / rateWithout : rateWith === 0 ? 0 : 99;
    const eventsWithout = Math.round(rateWithout * without.length);
    const measures = { daysWithStrategy: withUse.length, daysWithout: without.length, eventsPerDayWith: Math.round(rateWith * 100) / 100, eventsPerDayWithout: Math.round(rateWithout * 100) / 100, eventsWithout, ratio: Math.round(ratio * 100) / 100 };
    if (rateWithout === 0 || eventsWithout < this.thresholds.minEventsWithout! || ratio > this.thresholds.maxRatio!) return notFired(measures);
    return fired(0.4 + 0.6 * Math.min(1, (0.6 - ratio) / 0.6), [...events, ...uses], measures);
  },
};
