import type { PatternDefinition } from '../engine/window';
import { byDimension, checkSufficiency, distinctDays, fired, insufficient, mean, notFired, ofType, spanDays, stddev, values } from '../engine/window';

/**
 * The motivating example (docs/02): performance in one work arrangement materially exceeds
 * another across enough assessments spanning enough weeks. Thresholds are provisional (open
 * question #5) and live in `thresholds` so they can be tuned without code changes.
 */
export const contextPerformanceDivergence: PatternDefinition = {
  id: 'context-performance-divergence',
  version: 1,
  title: 'Context performance divergence',
  plainLanguage:
    'Graded work in one setting (for example independent work) has been scoring noticeably higher than graded work in another setting (for example group work) over several weeks.',
  requiredSignals: { types: ['assignment_grade', 'assessment_score'], minObservations: 8, minDistinctDays: 6, minSpanDays: 21 },
  confounders: [
    'Chronic absence independently depresses grades',
    'Group grades may be shared scores rather than individual performance',
    'Group work may coincide with one particular period or subject',
    'There are usually far fewer group assessments than independent ones, so the sample is small',
  ],
  routing: 'teacher_review',
  suppression: { cooldownDays: 45, maxActivePerStudent: 1 },
  status: 'active',
  thresholds: { minPerContext: 3, minDifferencePoints: 15, minEffectSize: 0.8 },
  reviewer: null,
  proxyReview:
    'Compares the same student with themselves across contexts, never against other students. Attendance is listed as a confounder for the interpreter, not used as a feature.',
  detect(ctx) {
    const grades = ofType(ctx.window.signals, this.requiredSignals.types);
    const missing = checkSufficiency(this, ctx.window.signals);
    if (missing.length) return insufficient(missing, { graded: grades.length });
    const groups = byDimension(grades, 'work_arrangement');
    const tagged = [...groups.values()].reduce((n, g) => n + g.length, 0);
    if (groups.size < 2) {
      return insufficient([`graded work tagged with at least two work arrangements (have ${groups.size}); tag assignments as independent / group_work / paired`], { graded: grades.length, tagged });
    }
    // Find the best-separated pair of contexts with enough observations in each.
    let best: { hi: string; lo: string; diff: number; effect: number; hiN: number; loN: number; hiMean: number; loMean: number } | null = null;
    const entries = [...groups.entries()].filter(([, g]) => g.length >= this.thresholds.minPerContext!);
    if (entries.length < 2) {
      return insufficient([`at least ${this.thresholds.minPerContext} graded entries in each of two work arrangements`], { graded: grades.length, tagged });
    }
    for (const [a, ga] of entries) {
      for (const [b, gb] of entries) {
        if (a === b) continue;
        const ma = mean(values(ga))!;
        const mb = mean(values(gb))!;
        if (ma <= mb) continue;
        const sa = stddev(values(ga)) ?? 0;
        const sb = stddev(values(gb)) ?? 0;
        const pooled = Math.sqrt((sa * sa + sb * sb) / 2) || 1;
        const effect = (ma - mb) / pooled;
        const diff = ma - mb;
        if (!best || diff > best.diff) best = { hi: a, lo: b, diff, effect, hiN: ga.length, loN: gb.length, hiMean: ma, loMean: mb };
      }
    }
    if (!best) return notFired({ graded: grades.length, tagged });
    const evidence = [...groups.get(best.hi)!, ...groups.get(best.lo)!];
    const measures = {
      highMean: Math.round(best.hiMean * 10) / 10,
      lowMean: Math.round(best.loMean * 10) / 10,
      differencePoints: Math.round(best.diff * 10) / 10,
      effectSize: Math.round(best.effect * 100) / 100,
      highCount: best.hiN,
      lowCount: best.loN,
      distinctDays: distinctDays(evidence),
      spanDays: spanDays(evidence),
      highContextIndex: ['group_work', 'independent', 'paired', 'whole_class'].indexOf(best.hi),
      lowContextIndex: ['group_work', 'independent', 'paired', 'whole_class'].indexOf(best.lo),
    };
    if (best.diff < this.thresholds.minDifferencePoints! || best.effect < this.thresholds.minEffectSize!) return notFired(measures);
    const strength = 0.5 * Math.min(1, best.diff / 30) + 0.3 * Math.min(1, best.effect / 2) + 0.2 * Math.min(1, Math.min(best.hiN, best.loN) / 8);
    return fired(strength, evidence, measures);
  },
};
