import { describe, expect, it } from 'vitest';
import type { ComputedRecommendation, InterventionProposal, PlanContent, ReviewNarrative } from '@class-pulse/domain';
import { MockProvider } from '../egress/mock';
import { checkPlanDeterministic } from './plan';
import { checkProposalDeterministic } from './pattern';
import { checkNarrativeDeterministic } from './review';
import { classifierFindings, combine } from './index';
import { EVAL_CASES } from '../evals/cases';

async function mockPlan(caseId = '001', scenario: 'default' | 'v1_failure' = 'default'): Promise<PlanContent> {
  const c = EVAL_CASES.find((x) => x.id === caseId)!;
  const res = await new MockProvider(scenario).complete({
    surface: 'plan_generation',
    model: 'x',
    reasoningEffort: null,
    maxOutputTokens: 1,
    instructions: '',
    input: JSON.stringify({ intake: c.intake }),
    schemaName: 'p',
    jsonSchema: {},
  });
  return res.outputJson as PlanContent;
}

describe('plan guardrails', () => {
  it('passes the mock reference plan for the source case', async () => {
    const plan = await mockPlan();
    const findings = checkPlanDeterministic(plan);
    expect(findings.filter((f) => f.severity === 'reject')).toEqual([]);
  });

  it('rejects a V1-style numeric target without a baseline (Phase 1 exit criterion)', async () => {
    const plan = await mockPlan('001', 'v1_failure');
    const findings = checkPlanDeterministic(plan);
    expect(findings.some((f) => f.check === 'target_without_baseline' && f.severity === 'reject')).toBe(true);
    expect(combine(findings, null).passed).toBe(false);
  });

  it('flags vague terms, rejects causal hypotheses, diagnostic vocabulary and empty sections', async () => {
    const plan = await mockPlan();
    plan.measurableGoals[0]!.observableDefinition = 'The student will stay focused and on task';
    plan.hypothesesToMonitor[0]!.hypothesis = 'The student talks because the work is boring';
    plan.preventiveStrategies[0]!.description = 'Consider that the student may have ADHD';
    plan.replacementBehaviors = [];
    plan.documentedPatterns = [];
    const checks = checkPlanDeterministic(plan).map((f) => `${f.check}:${f.severity}`);
    expect(checks).toContain('vague_term:flag');
    expect(checks).toContain('causal_language_in_hypothesis:reject');
    expect(checks).toContain('diagnostic_vocabulary:reject');
    expect(checks).toContain('required_section:reject');
    // Empty patterns are allowed only when missingInformation asks for them.
    expect(checks).toContain('empty_optional_section:reject');
    plan.missingInformation.push('Documented situations in which the behavior is least likely.');
    expect(checkPlanDeterministic(plan).map((f) => `${f.check}:${f.severity}`)).toContain('empty_optional_section:flag');
  });

  it('rejects a target set from a baseline with fewer than three observations', async () => {
    const plan = await mockPlan('008');
    plan.measurableGoals[0]!.baseline = { status: 'available', value: 1, unit: 'events', observations: 1, spanDays: 1 };
    plan.measurableGoals[0]!.target = { status: 'proposed', value: 0, unit: 'events', rationale: 'x' };
    expect(checkPlanDeterministic(plan).some((f) => f.check === 'baseline_too_thin' && f.severity === 'reject')).toBe(true);
  });

  it('rejects a target the model presents as established', async () => {
    const plan = await mockPlan('008');
    plan.measurableGoals[0]!.target = { status: 'established', value: 2, unit: 'events', establishedBy: null };
    expect(checkPlanDeterministic(plan).some((f) => f.check === 'target_established_by_model')).toBe(true);
  });

  it('only flags (does not reject) disability vocabulary inside the privacy/human-review notes', async () => {
    const plan = await mockPlan();
    plan.privacyAndHumanReviewNotes.humanReviewRequired.push('This plan does not infer any disability.');
    const f = checkPlanDeterministic(plan).filter((x) => x.check === 'diagnostic_vocabulary');
    expect(f.length).toBe(1);
    expect(f[0]!.severity).toBe('flag');
  });

  it('rejects determination language in strategies', async () => {
    const plan = await mockPlan();
    plan.teacherResponseStrategies[0]!.description = 'Send the student to detention after the third occurrence.';
    expect(checkPlanDeterministic(plan).some((f) => f.check === 'determination_language')).toBe(true);
  });
});

const proposal: InterventionProposal = {
  evidenceRestatement: 'x',
  hypothesis: 'One possibility to monitor is that the student does better alone.',
  alternativeExplanations: [
    { confounder: 'Chronic absence independently depresses grades', assessment: 'not ruled out' },
    { confounder: 'Group grades may be shared scores rather than individual performance', assessment: 'not ruled out' },
  ],
  proposedInterventions: [{ description: 'Offer an individual version of one group task.', rationale: 'r', effortLevel: 'low', workloadJustification: null, whatWouldConfirm: 'w' }],
  dataToCollect: [],
  humanReviewNotes: '',
};
const confounders = ['Chronic absence independently depresses grades', 'Group grades may be shared scores rather than individual performance'];

describe('pattern guardrails', () => {
  it('passes a proposal that addresses every confounder', () => {
    expect(checkProposalDeterministic(proposal, confounders, 'teacher_review')).toEqual([]);
  });
  it('rejects when a confounder is skipped', () => {
    const p = { ...proposal, alternativeExplanations: proposal.alternativeExplanations.slice(0, 1) };
    expect(checkProposalDeterministic(p, confounders, 'teacher_review').map((f) => f.check)).toContain('confounder_not_addressed');
  });
  it('rejects causal hypotheses, unjustified high effort, determination language and interventions on safety routing', () => {
    const p: InterventionProposal = {
      ...proposal,
      hypothesis: 'The student struggles because of group work',
      proposedInterventions: [
        { description: 'Refer for evaluation and consider a placement change.', rationale: 'r', effortLevel: 'high', workloadJustification: null, whatWouldConfirm: 'w' },
      ],
    };
    const checks = checkProposalDeterministic(p, confounders, 'safety_escalation').map((f) => f.check);
    expect(checks).toContain('causal_language_in_hypothesis');
    expect(checks).toContain('high_effort_unjustified');
    expect(checks).toContain('determination_language');
    expect(checks).toContain('safety_escalation_has_interventions');
  });
});

describe('review narration guardrails', () => {
  const computed: ComputedRecommendation = {
    decision: 'continue',
    firedCriteria: [],
    goalSummaries: [],
    implementationConsistency: { strategyUsesInWindow: 0, weeksWithStrategyUse: 0, weeksInWindow: 2 },
    rationale: [],
  };
  const narrative: ReviewNarrative = { decision: 'modify', summaryForTeacher: 'x', summaryForStudent: 'y', summaryForFamily: 'z', suggestedAdjustments: [], humanReviewNotes: '' };
  it('rejects a narrative whose decision differs from the computed one', () => {
    expect(checkNarrativeDeterministic(narrative, computed).map((f) => f.check)).toContain('decision_mismatch');
    expect(checkNarrativeDeterministic({ ...narrative, decision: 'continue' }, computed)).toEqual([]);
  });
});

describe('classifier thresholds', () => {
  it('rejects high-confidence high scores and flags the rest', () => {
    const f = classifierFindings({ unsupportedCausalClaims: 0.9, hypothesesStatedAsFact: 0.5, stigmatizingLanguage: 0.1, outsideEducationalScope: 0.8, confidence: 0.9, notes: '' });
    expect(f.map((x) => `${x.check}:${x.severity}`)).toEqual(['classifier.unsupportedCausalClaims:reject', 'classifier.hypothesesStatedAsFact:flag', 'classifier.outsideEducationalScope:reject']);
    const low = classifierFindings({ unsupportedCausalClaims: 0.9, hypothesesStatedAsFact: 0, stigmatizingLanguage: 0, outsideEducationalScope: 0, confidence: 0.3, notes: '' });
    expect(low.map((x) => x.severity)).toEqual(['flag']);
  });
});
