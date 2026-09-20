import type { PatternDefinition } from '../engine/window';
import { byDimension, checkSufficiency, fired, insufficient, notFired, ofType } from '../engine/window';

const UNSTRUCTURED = ['transition', 'unstructured_time'];

/** Events cluster in transitions and unstructured blocks relative to structured time. */
export const unstructuredTimeClustering: PatternDefinition = {
  id: 'unstructured-time-clustering',
  version: 1,
  title: 'Unstructured-time clustering',
  plainLanguage: 'Behavior events are happening mostly during transitions and unstructured time rather than during structured instruction.',
  requiredSignals: { types: ['behavior_event'], minObservations: 10, minDistinctDays: 6, minSpanDays: 14 },
  confounders: [
    'Transitions are short, so a few events make a large share',
    'Structured-time events may be under-logged because the teacher is instructing',
    'Specific transitions (arrival, after lunch) may matter more than unstructured time in general',
  ],
  routing: 'teacher_review',
  suppression: { cooldownDays: 30, maxActivePerStudent: 1 },
  status: 'piloting',
  thresholds: { minUnstructuredShare: 0.5, minLift: 1.5, minUnstructuredEvents: 5 },
  reviewer: null,
  proxyReview: 'Structure tags only. Within-student.',
  detect(ctx) {
    const missing = checkSufficiency(this, ctx.window.signals);
    if (missing.length) return insufficient(missing);
    const events = ofType(ctx.window.signals, ['behavior_event']);
    const evBy = byDimension(events, 'structure');
    const allBy = byDimension(ctx.window.signals.filter((s) => s.type !== 'behavior_event'), 'structure');
    const evTagged = [...evBy.values()].reduce((n, g) => n + g.length, 0);
    const allTagged = [...allBy.values()].reduce((n, g) => n + g.length, 0);
    if (evTagged < this.thresholds.minUnstructuredEvents! || !allBy.has('structured')) return insufficient(['behavior events tagged with structure (structured / transition / unstructured_time), including some structured-time entries']);
    const unEv = UNSTRUCTURED.reduce((n, t) => n + (evBy.get(t)?.length ?? 0), 0);
    const unAll = UNSTRUCTURED.reduce((n, t) => n + (allBy.get(t)?.length ?? 0), 0);
    const share = unEv / evTagged;
    const exposure = unAll / allTagged;
    const lift = exposure > 0 ? share / exposure : 0;
    const measures = { unstructuredEvents: unEv, structuredEvents: evBy.get('structured')?.length ?? 0, unstructuredShare: Math.round(share * 100) / 100, exposureShare: Math.round(exposure * 100) / 100, lift: Math.round(lift * 100) / 100 };
    if (unEv < this.thresholds.minUnstructuredEvents! || share < this.thresholds.minUnstructuredShare! || lift < this.thresholds.minLift!) return notFired(measures);
    const evidence = UNSTRUCTURED.flatMap((t) => evBy.get(t) ?? []);
    return fired(0.4 + 0.6 * Math.min(1, (lift - 1) / 2), evidence, measures);
  },
};
