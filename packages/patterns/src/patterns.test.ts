import { describe, expect, it } from 'vitest';
import type { GoalContent, ReviewCriterion } from '@class-pulse/domain';
import { PATTERN_CATALOG, contextPerformanceDivergence, strengthUnderutilization } from './definitions';
import { applyTeacherCap, summarizeEvidence, sweepCase } from './engine/runner';
import { computeRecommendation } from './engine/review';
import { HISTORIES, HistoryBuilder, PLAN_ALL_USED, PLAN_TECH_UNUSED } from './evals/histories';
import { runDetectionEvals, formatDetectionReport } from './evals/runner';
import { PatternDefinitionMeta } from '@class-pulse/domain';

const NOW = new Date('2026-09-18T12:00:00Z');

describe('catalog', () => {
  it('every definition has valid metadata, confounders, a proxy review and a plain-language description', () => {
    for (const d of PATTERN_CATALOG) {
      const { detect: _d, ...meta } = d;
      expect(() => PatternDefinitionMeta.parse(meta)).not.toThrow();
      expect(d.confounders.length).toBeGreaterThanOrEqual(3);
      expect(d.proxyReview.length).toBeGreaterThan(20);
    }
    expect(PATTERN_CATALOG.filter((d) => d.status === 'active').map((d) => d.id)).toEqual(['strength-underutilization', 'context-performance-divergence']);
  });
});

describe('detection evals (precision / recall on labeled histories)', () => {
  it('every definition fires on its labeled history and stays silent on noise', () => {
    const r = runDetectionEvals({ now: NOW });
    expect(r.passed, formatDetectionReport(r)).toBe(true);
    for (const d of r.definitions) {
      expect(d.precision, d.definitionId).toBe(1);
      expect(d.recall, d.definitionId).toBe(1);
    }
  });
});

describe('sweepCase', () => {
  const motivating = HISTORIES.find((h) => h.id === 'motivating')!;

  it('reproduces the motivating example: a visible candidate with evidence refs and measures', () => {
    const out = sweepCase(motivating.build(NOW), { definitions: PATTERN_CATALOG, existing: [] });
    const cpd = out.candidates.find((c) => c.definition.id === 'context-performance-divergence');
    expect(cpd).toBeDefined();
    expect(cpd!.visible).toBe(true);
    expect(cpd!.result.evidenceRefs.length).toBeGreaterThanOrEqual(10);
    expect(cpd!.result.measures.differencePoints).toBeGreaterThanOrEqual(15);
    const summary = summarizeEvidence(motivating.build(NOW).window.signals, cpd!.result.evidenceRefs);
    expect(summary.map((s) => s.signalType).sort()).toEqual(['assessment_score', 'assignment_grade']);
    expect(JSON.stringify(summary)).not.toMatch(/ck-motivating-\d/);
  });

  it('keeps piloting candidates invisible and records insufficient-data notes', () => {
    const out = sweepCase(HISTORIES.find((h) => h.id === 'task-length')!.build(NOW), { definitions: PATTERN_CATALOG, existing: [] });
    const tl = out.candidates.find((c) => c.definition.id === 'task-length-sensitivity');
    expect(tl?.visible).toBe(false);
    expect(out.insufficient.some((i) => i.definitionId === 'attendance-performance-coupling')).toBe(true);
  });

  it('applies status overrides, max-active suppression and cooldowns', () => {
    const ctx = motivating.build(NOW);
    const retired = sweepCase(ctx, { definitions: PATTERN_CATALOG, existing: [], statusOverrides: new Map([['context-performance-divergence', 'retired']]) });
    expect(retired.candidates.some((c) => c.definition.id === 'context-performance-divergence')).toBe(false);
    const active = sweepCase(ctx, { definitions: PATTERN_CATALOG, existing: [{ definitionId: 'context-performance-divergence', status: 'in_review', detectedAt: NOW, adjudicatedAt: null }] });
    expect(active.suppressed.find((s) => s.definitionId === 'context-performance-divergence')?.reason).toMatch(/active candidate/);
    const cooled = sweepCase(ctx, { definitions: PATTERN_CATALOG, existing: [{ definitionId: 'context-performance-divergence', status: 'dismissed', detectedAt: NOW, adjudicatedAt: new Date(NOW.getTime() - 5 * 86_400_000) }] });
    expect(cooled.suppressed.find((s) => s.definitionId === 'context-performance-divergence')?.reason).toMatch(/cooldown/);
  });

  it('caps visible candidates per teacher by strength', () => {
    const r = applyTeacherCap([{ strength: 0.3, id: 'a' }, { strength: 0.9, id: 'b' }, { strength: 0.6, id: 'c' }], 1, 3);
    expect(r.surface.map((x) => x.id)).toEqual(['b', 'c']);
    expect(r.hold.map((x) => x.id)).toEqual(['a']);
  });
});

describe('strength-underutilization', () => {
  it('fires only when a strength is unused by every active strategy', () => {
    const b = new HistoryBuilder('ck', NOW);
    expect(strengthUnderutilization.detect(b.build(PLAN_TECH_UNUSED)).fired).toBe(true);
    expect(strengthUnderutilization.detect(b.build(PLAN_ALL_USED)).fired).toBe(false);
    expect(strengthUnderutilization.detect(b.build(null)).fired).toBe(false);
  });
});

describe('context-performance-divergence sufficiency', () => {
  it('asks for tags when grades are untagged', () => {
    const b = new HistoryBuilder('ck', NOW);
    for (let d = 30; d > 0; d -= 3) b.grade(d, 80, []);
    const r = contextPerformanceDivergence.detect(b.build());
    expect(r.insufficientData?.missing[0]).toMatch(/work arrangements/);
  });
});

describe('review-cycle engine', () => {
  const goal: GoalContent & { id: string } = {
    id: 'g1',
    targetBehavior: 'Leaving the assigned area',
    observableDefinition: 'x',
    baseline: { status: 'available', value: 4, unit: 'events per period', observations: 5, spanDays: 5 },
    measurementMethod: 'frequency_count',
    direction: 'decrease',
    target: { status: 'proposed', value: 2, unit: 'events per period', rationale: 'r' },
    reviewPeriodDays: 14,
  };
  const criteria: ReviewCriterion[] = [
    { goalIndex: 0, description: 'down 30%', metric: 'events_per_day', comparator: 'change_pct_lte', value: -30, windowDays: 14, minObservations: 6, decision: 'continue' },
    { goalIndex: 0, description: 'unchanged', metric: 'events_per_day', comparator: 'change_pct_gte', value: 0, windowDays: 14, minObservations: 6, decision: 'modify' },
    { goalIndex: 0, description: 'thin', metric: 'events_per_day', comparator: 'insufficient_data', value: null, windowDays: 14, minObservations: 6, decision: 'collect_more' },
    { goalIndex: null, description: 'up 25% over 4 weeks', metric: 'events_per_day', comparator: 'change_pct_gte', value: 25, windowDays: 28, minObservations: 10, decision: 'seek_support' },
  ];

  it('recommends collect_more when data is thin', () => {
    const b = new HistoryBuilder('ck', NOW);
    b.event(2, [], 10, 'g1').event(3, [], 10, 'g1');
    const r = computeRecommendation({ goals: [goal], criteria, signals: b.build().window.signals, now: NOW });
    expect(r.decision).toBe('collect_more');
    expect(r.goalSummaries[0]!.trend).toBe('insufficient_data');
  });

  it('recommends continue when the goal is improving against baseline', () => {
    const b = new HistoryBuilder('ck', NOW);
    for (let d = 1; d <= 10; d++) {
      b.event(d, [], 10, 'g1');
      if (d % 2 === 0) b.event(d, [], 11, 'g1');
      b.strategyUse(d);
    }
    const r = computeRecommendation({ goals: [goal], criteria, signals: b.build().window.signals, now: NOW });
    expect(r.goalSummaries[0]!.currentValue).toBe(1.5);
    expect(r.goalSummaries[0]!.trend).toBe('improving');
    expect(r.decision).toBe('continue');
    expect(r.implementationConsistency.weeksWithStrategyUse).toBeGreaterThanOrEqual(2);
  });

  it('recommends modify when counts are flat or worse, and never lets a narrative decide', () => {
    const b = new HistoryBuilder('ck', NOW);
    for (let d = 1; d <= 10; d++) for (let k = 0; k < 4; k++) b.event(d, [], 9 + k, 'g1');
    const r = computeRecommendation({ goals: [goal], criteria, signals: b.build().window.signals, now: NOW });
    expect(r.decision).toBe('modify');
    expect(r.firedCriteria.map((f) => f.decision)).toContain('modify');
  });
});
