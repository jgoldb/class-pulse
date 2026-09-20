import { describe, expect, it } from 'vitest';
import { EgressGate, MockProvider, aiConfigFromEnv, modelResolverFromConfig } from './egress';
import { generatePlan, interpretPattern, narrateReview, seedPromptFor } from './index';
import { EVAL_CASES } from './evals/cases';
import { runEvals } from './evals/runner';

function ctx(provider = new MockProvider()) {
  const cfg = aiConfigFromEnv({ AI_PROVIDER: 'mock', NODE_ENV: 'test' } as never);
  let n = 0;
  const gate = new EgressGate({ provider, resolveModel: modelResolverFromConfig(cfg), posture: cfg.posture, writeLog: () => {}, newRunId: () => `r${++n}` });
  return {
    gate,
    prompts: {
      plan_generation: seedPromptFor('plan_generation'),
      pattern_interpretation: seedPromptFor('pattern_interpretation'),
      review_narration: seedPromptFor('review_narration'),
      guardrail_classifier: seedPromptFor('guardrail_classifier'),
    },
    cfg,
  };
}

describe('generatePlan (Phase 0 exit criterion)', () => {
  it('returns a structured draft that refuses to invent a baseline from the grade-6 case', async () => {
    const c = ctx();
    const r = await generatePlan(c, { intake: EVAL_CASES[0]!.intake });
    expect(r.status).toBe('succeeded');
    if (r.status !== 'succeeded') return;
    expect(r.output.measurableGoals.length).toBeGreaterThanOrEqual(2);
    for (const g of r.output.measurableGoals) {
      expect(g.baseline.status).toBe('ambiguous');
      expect(g.target.status).toBe('blocked_on_baseline');
    }
    expect(r.guardrails.classifier).not.toBeNull();
    expect(r.runs.length).toBe(2); // generation + classifier
  });

  it('rejects (after one regeneration) when the model keeps producing a V1-style target', async () => {
    const c = ctx(new MockProvider('v1_failure'));
    const r = await generatePlan(c, { intake: EVAL_CASES[0]!.intake });
    expect(r.status).toBe('rejected');
    if (r.status !== 'rejected') return;
    expect(r.attempts).toBe(2);
    expect(r.guardrails.findings.some((f) => f.check === 'target_without_baseline')).toBe(true);
  });

  it('blocks PII before anything leaves', async () => {
    const c = ctx();
    const r = await generatePlan({ ...c, denyNames: ['Marcus Johnson'] }, { intake: EVAL_CASES[3]!.intake });
    expect(r.status).toBe('blocked_pii');
  });
});

describe('interpretPattern and narrateReview', () => {
  it('produces a proposal that addresses every confounder and passes guardrails', async () => {
    const c = ctx();
    const r = await interpretPattern(c, {
      definition: { id: 'context-performance-divergence', version: 1, title: 'Context Performance Divergence', plainLanguage: 'Performance in one setting is materially higher than in another.' },
      measures: { independentMean: 90, groupMean: 65, difference: 25 },
      evidence: [{ signalType: 'assignment_grade', count: 12, distinctDays: 12, spanDays: 35, contextTags: ['independent', 'group_work'], mean: 78, byContext: [{ tag: 'independent', count: 7, mean: 90 }, { tag: 'group_work', count: 5, mean: 65 }] }],
      confounders: ['Chronic absence independently depresses grades', 'Group grades may be shared scores'],
      strengths: ['technology'],
      activeStrategies: [{ kind: 'preventive', description: 'chunked tasks' }],
      routing: 'teacher_review',
      gradeLevel: '6',
    });
    expect(r.status).toBe('succeeded');
    if (r.status === 'succeeded') expect(r.output.alternativeExplanations.length).toBe(2);
  });

  it('narrates a computed decision without changing it', async () => {
    const c = ctx();
    const computed = {
      decision: 'collect_more' as const,
      firedCriteria: [],
      goalSummaries: [{ goalIndex: 0, targetBehavior: 'Leaving seat', observations: 3, windowDays: 14, currentValue: null, baselineValue: null, changePct: null, trend: 'insufficient_data' as const }],
      implementationConsistency: { strategyUsesInWindow: 2, weeksWithStrategyUse: 1, weeksInWindow: 2 },
      rationale: ['Fewer than 6 observations.'],
    };
    const r = await narrateReview(c, { computed, goals: [{ targetBehavior: 'Leaving seat', observableDefinition: 'x' }], gradeLevel: '6' });
    expect(r.status).toBe('succeeded');
    if (r.status === 'succeeded') expect(r.output.decision).toBe('collect_more');
  });
});

describe('eval harness (Phase 1 exit criterion)', () => {
  it('passes every case with the v1 prompt on the mock provider', async () => {
    const c = ctx();
    const report = await runEvals({ provider: new MockProvider(), resolveModel: modelResolverFromConfig(c.cfg), posture: c.cfg.posture });
    const failing = report.cases.filter((x) => !x.passed).map((x) => `${x.id}: ${x.assertions.filter((a) => !a.passed).map((a) => `${a.assertion}(${a.detail})`).join(', ')} ${x.judge && !x.judge.overallPass ? x.judge.summary : ''}`);
    expect(failing).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.totalCases).toBe(EVAL_CASES.length);
  }, 30_000);

  it('fails when a prompt/model reintroduces the V1 failure, so promotion is blocked', async () => {
    const c = ctx();
    const report = await runEvals({ provider: new MockProvider('v1_failure'), resolveModel: modelResolverFromConfig(c.cfg), posture: c.cfg.posture, judge: false, cases: [EVAL_CASES[0]!] });
    expect(report.passed).toBe(false);
    expect(report.cases[0]!.assertions.find((a) => a.assertion === 'no_numeric_target')?.passed).toBe(false);
  });
});
