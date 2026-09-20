import type { PatternDefinition } from '../engine/window';
import { byDimension, checkSufficiency, fired, insufficient, notFired, ofType } from '../engine/window';

const PERIODS = ['period_1', 'period_2', 'period_3', 'period_4', 'period_5', 'period_6', 'period_7', 'period_8'];

/**
 * Events concentrate in specific periods beyond chance. Expected share per period is estimated
 * from how often *anything* was logged in that period (exposure), and a binomial z-score tests
 * the observed event count against it.
 */
export const timeOfDayClustering: PatternDefinition = {
  id: 'time-of-day-clustering',
  version: 1,
  title: 'Time-of-day clustering',
  plainLanguage: 'Behavior events are concentrated in one class period much more than would be expected from how often that period is logged.',
  requiredSignals: { types: ['behavior_event'], minObservations: 12, minDistinctDays: 8, minSpanDays: 14 },
  confounders: [
    'The concentrated period may be the only one where the teacher logs consistently',
    'That period may coincide with a particular subject, task type or seating arrangement',
    'Timing around lunch, arrival or dismissal may matter more than the period itself',
  ],
  routing: 'teacher_review',
  suppression: { cooldownDays: 30, maxActivePerStudent: 1 },
  status: 'piloting',
  thresholds: { minZ: 2.0, minEventsInPeriod: 5, minPeriodsObserved: 2 },
  reviewer: null,
  proxyReview: 'Schedule tags only. Within-student. No demographic or attendance input.',
  detect(ctx) {
    const missing = checkSufficiency(this, ctx.window.signals);
    if (missing.length) return insufficient(missing);
    const events = ofType(ctx.window.signals, ['behavior_event']);
    const evBy = byDimension(events, 'schedule');
    // Exposure from non-event entries; if the teacher only logs events, fall back to a uniform
    // expectation across the periods that appear anywhere in the window.
    let allBy = byDimension(ctx.window.signals.filter((s) => s.type !== 'behavior_event'), 'schedule');
    const exposureEntries = [...allBy.values()].reduce((n, g) => n + g.length, 0);
    if (exposureEntries < 8) {
      const seen = PERIODS.filter((p) => byDimension(ctx.window.signals, 'schedule').has(p));
      allBy = new Map(seen.map((p) => [p, [events[0]!]]));
    }
    const periodsObserved = PERIODS.filter((p) => (allBy.get(p)?.length ?? 0) > 0);
    if (periodsObserved.length < this.thresholds.minPeriodsObserved!) return insufficient([`entries tagged with at least ${this.thresholds.minPeriodsObserved} different periods`]);
    const totalEvents = periodsObserved.reduce((n, p) => n + (evBy.get(p)?.length ?? 0), 0);
    const totalAll = periodsObserved.reduce((n, p) => n + (allBy.get(p)?.length ?? 0), 0);
    if (totalEvents < this.thresholds.minEventsInPeriod!) return insufficient(['more behavior events tagged with a period']);
    let best: { period: string; z: number; observed: number; expected: number } | null = null;
    for (const p of periodsObserved) {
      const observed = evBy.get(p)?.length ?? 0;
      const share = (allBy.get(p)?.length ?? 0) / totalAll;
      const expected = totalEvents * share;
      const sd = Math.sqrt(totalEvents * share * (1 - share)) || 1;
      const z = (observed - expected) / sd;
      if (!best || z > best.z) best = { period: p, z, observed, expected };
    }
    if (!best) return notFired();
    const measures = {
      periodIndex: PERIODS.indexOf(best.period) + 1,
      observedEvents: best.observed,
      expectedEvents: Math.round(best.expected * 10) / 10,
      zScore: Math.round(best.z * 100) / 100,
      totalEvents,
      periodsObserved: periodsObserved.length,
    };
    if (best.z < this.thresholds.minZ! || best.observed < this.thresholds.minEventsInPeriod!) return notFired(measures);
    return fired(0.4 + 0.6 * Math.min(1, (best.z - 2) / 3), evBy.get(best.period) ?? [], measures);
  },
};
