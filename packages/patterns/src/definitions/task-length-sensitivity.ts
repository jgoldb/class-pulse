import type { PatternDefinition } from '../engine/window';
import { byDimension, checkSufficiency, fired, insufficient, notFired, ofType } from '../engine/window';

const ORDER = ['short_task', 'long_assignment', 'multi_day'];

/**
 * Behavior-event share rises with assignment duration. Exposure is estimated from *all* logged
 * entries carrying a task-length tag (grades, strategy uses, observations, events), so the rule
 * measures over-representation ("lift") rather than raw counts.
 */
export const taskLengthSensitivity: PatternDefinition = {
  id: 'task-length-sensitivity',
  version: 1,
  title: 'Task length sensitivity',
  plainLanguage: 'Behavior events are showing up more often during longer assignments than during shorter tasks, relative to how much of each has been logged.',
  requiredSignals: { types: ['behavior_event'], minObservations: 10, minDistinctDays: 6, minSpanDays: 14 },
  confounders: [
    'Longer assignments may simply offer more time in which an event can be logged',
    'Long assignments may cluster in one subject or period',
    'Teachers may log more carefully during long assignments',
    'Task length tags may be applied inconsistently',
  ],
  routing: 'teacher_review',
  suppression: { cooldownDays: 30, maxActivePerStudent: 1 },
  status: 'piloting',
  thresholds: { minLift: 1.5, minEventsInLong: 5, minExposureEntriesPerTag: 4 },
  reviewer: null,
  proxyReview: 'Within-student comparison across task lengths; no attendance, discipline history or demographic input.',
  detect(ctx) {
    const missing = checkSufficiency(this, ctx.window.signals);
    if (missing.length) return insufficient(missing);
    const events = ofType(ctx.window.signals, ['behavior_event']);
    const eventsByLen = byDimension(events, 'task_length');
    // Exposure = everything logged that is NOT an event (grades, strategy uses, observations,
    // self-checks). Counting events in their own denominator would damp the very signal we test.
    const allByLen = byDimension(ctx.window.signals.filter((s) => s.type !== 'behavior_event'), 'task_length');
    if (allByLen.size < 2) return insufficient(['non-event entries (grades, strategy uses, observations) tagged with at least two task lengths (short_task / long_assignment / multi_day)']);
    const totalEvents = [...eventsByLen.values()].reduce((n, g) => n + g.length, 0);
    const totalAll = [...allByLen.values()].reduce((n, g) => n + g.length, 0);
    if (totalEvents === 0) return notFired();
    const shares: Record<string, { eventShare: number; exposureShare: number; lift: number; n: number }> = {};
    for (const tag of ORDER) {
      const ev = eventsByLen.get(tag)?.length ?? 0;
      const ex = allByLen.get(tag)?.length ?? 0;
      if (ex < this.thresholds.minExposureEntriesPerTag!) continue;
      const eventShare = ev / totalEvents;
      const exposureShare = ex / totalAll;
      shares[tag] = { eventShare, exposureShare, lift: exposureShare ? eventShare / exposureShare : 0, n: ev };
    }
    const long = shares.multi_day && shares.multi_day.n >= this.thresholds.minEventsInLong! ? { tag: 'multi_day', ...shares.multi_day } : shares.long_assignment ? { tag: 'long_assignment', ...shares.long_assignment } : null;
    const short = shares.short_task;
    if (!long || !short) return insufficient(['events and other entries tagged both short_task and long_assignment']);
    const measures = {
      longEvents: long.n,
      shortEvents: short.n,
      longLift: Math.round(long.lift * 100) / 100,
      shortLift: Math.round(short.lift * 100) / 100,
      ratio: short.lift > 0 ? Math.round((long.lift / short.lift) * 100) / 100 : 0,
    };
    if (long.n < this.thresholds.minEventsInLong! || long.lift < this.thresholds.minLift! || long.lift <= short.lift) return notFired(measures);
    const evidence = [...(eventsByLen.get(long.tag) ?? []), ...(eventsByLen.get('short_task') ?? [])];
    return fired(0.4 + 0.6 * Math.min(1, (long.lift - 1) / 2), evidence, measures);
  },
};
