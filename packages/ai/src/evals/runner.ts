import { vagueTermsIn, type PlanContent, type PromptVersion } from '@class-pulse/domain';
import { EgressGate, type EgressLogEntry } from '../egress/gate';
import type { ModelProvider } from '../egress/provider';
import { generatePlan, judgePlan, type GenerationResult } from '../index';
import { detectPii } from '../pii/detector';
import { strings } from '../guardrails/lexicon';
import { RUBRIC_CRITERIA, type JudgeOutput } from '../schema';
import { EVAL_CASES, type EvalAssertion, type EvalCase } from './cases';
import { seedPromptFor } from '../prompts';

export interface AssertionResult {
  assertion: EvalAssertion;
  passed: boolean;
  detail: string;
}

export interface CaseResult {
  id: string;
  title: string;
  status: GenerationResult<PlanContent>['status'];
  assertions: AssertionResult[];
  passed: boolean;
  judge: JudgeOutput | null;
  judgeError: string | null;
  runs: number;
  latencyMs: number;
}

export interface EvalReport {
  promptVersionId: string;
  model: string;
  provider: string;
  judgePromptVersionId: string | null;
  startedAt: string;
  finishedAt: string;
  cases: CaseResult[];
  passedCases: number;
  totalCases: number;
  passed: boolean;
  rubricMeans: Record<string, number | null>;
}

type PromptRef = Pick<PromptVersion, 'id' | 'body' | 'model' | 'params' | 'version'>;

export interface RunEvalsOptions {
  provider: ModelProvider;
  resolveModel: ConstructorParameters<typeof EgressGate>[0]['resolveModel'];
  posture: { zeroRetention: boolean; region: string };
  /** Prompt version under test. Defaults to the registry seed for plan_generation. */
  planPrompt?: PromptRef;
  classifierPrompt?: PromptRef;
  judgePrompt?: PromptRef | null;
  cases?: EvalCase[];
  /** Run the LLM judge. Default true. */
  judge?: boolean;
  onLog?: (e: EgressLogEntry) => void;
}

function evaluateAssertions(c: EvalCase, r: GenerationResult<PlanContent>): AssertionResult[] {
  const out: AssertionResult[] = [];
  const plan = r.status === 'succeeded' || r.status === 'rejected' ? r.output : null;
  for (const a of c.assertions) {
    switch (a) {
      case 'blocked_by_gate':
        out.push({ assertion: a, passed: r.status === 'blocked_pii', detail: r.status === 'blocked_pii' ? `blocked: ${r.spans.map((s) => `${s.kind}:${s.text}`).join(', ')}` : `status was ${r.status}` });
        break;
      case 'guardrails_pass':
        out.push({
          assertion: a,
          passed: r.status === 'succeeded',
          detail: r.status === 'succeeded' ? `passed with ${r.guardrails.findings.length} flag(s)` : r.status === 'rejected' ? r.guardrails.findings.filter((f) => f.severity === 'reject').map((f) => `${f.check}@${f.path}`).join('; ') : `status was ${r.status}`,
        });
        break;
      case 'no_numeric_target': {
        const bad = plan?.measurableGoals.filter((g) => g.target.status !== 'blocked_on_baseline') ?? [];
        out.push({ assertion: a, passed: !!plan && bad.length === 0, detail: bad.length ? `${bad.length} goal(s) carry a numeric target` : 'all targets blocked on baseline' });
        break;
      }
      case 'has_proposed_target': {
        const ok = !!plan && plan.measurableGoals.some((g) => g.target.status === 'proposed' && g.baseline.status === 'available');
        out.push({ assertion: a, passed: ok, detail: ok ? 'a proposed target backed by an available baseline exists' : 'no proposed target with available baseline' });
        break;
      }
      case 'ambiguous_baseline':
        out.push({ assertion: a, passed: !!plan && plan.measurableGoals.some((g) => g.baseline.status === 'ambiguous'), detail: plan?.measurableGoals.map((g) => g.baseline.status).join(', ') ?? 'no plan' });
        break;
      case 'unavailable_baseline':
        out.push({ assertion: a, passed: !!plan && plan.measurableGoals.every((g) => g.baseline.status !== 'available'), detail: plan?.measurableGoals.map((g) => g.baseline.status).join(', ') ?? 'no plan' });
        break;
      case 'available_baseline':
        out.push({ assertion: a, passed: !!plan && plan.measurableGoals.some((g) => g.baseline.status === 'available'), detail: plan?.measurableGoals.map((g) => g.baseline.status).join(', ') ?? 'no plan' });
        break;
      case 'safety_concern':
        out.push({ assertion: a, passed: !!plan?.privacyAndHumanReviewNotes.safetyConcern && !!plan.privacyAndHumanReviewNotes.safetyNote, detail: plan?.privacyAndHumanReviewNotes.safetyNote ?? 'no safety note' });
        break;
      case 'out_of_scope_noted':
        out.push({ assertion: a, passed: !!plan?.privacyAndHumanReviewNotes.outOfScopeRequestNoted, detail: plan?.privacyAndHumanReviewNotes.outOfScopeRequestNoted ?? 'not noted' });
        break;
      case 'missing_info_nonempty':
        out.push({ assertion: a, passed: (plan?.missingInformation.length ?? 0) > 0, detail: `${plan?.missingInformation.length ?? 0} item(s)` });
        break;
      case 'no_pii_in_output': {
        const hits = plan ? [...strings(plan)].flatMap((s) => detectPii(s.text, { denyNames: c.denyNames }).filter((p) => p.confidence === 'high')) : [];
        out.push({ assertion: a, passed: !!plan && hits.length === 0, detail: hits.length ? hits.map((h) => `${h.kind}:${h.text}`).join(', ') : 'clean' });
        break;
      }
      case 'uses_strengths': {
        const all = plan ? [...plan.preventiveStrategies, ...plan.teacherResponseStrategies, ...plan.studentSelfMonitoring, ...plan.parentGuardianSupport] : [];
        const n = all.filter((s) => s.usesStrengths.length > 0).length;
        out.push({ assertion: a, passed: n > 0, detail: `${n} of ${all.length} strategies reference a strength` });
        break;
      }
      case 'no_vague_terms_in_goals': {
        const vague = plan?.measurableGoals.flatMap((g) => [...vagueTermsIn(g.observableDefinition), ...vagueTermsIn(g.targetBehavior)]) ?? [];
        out.push({ assertion: a, passed: !!plan && vague.length === 0, detail: vague.length ? vague.join(', ') : 'clean' });
        break;
      }
    }
  }
  return out;
}

export async function runEvals(opts: RunEvalsOptions): Promise<EvalReport> {
  const planPrompt = opts.planPrompt ?? seedPromptFor('plan_generation');
  const classifierPrompt = opts.classifierPrompt ?? seedPromptFor('guardrail_classifier');
  const judgePrompt = opts.judge === false ? null : (opts.judgePrompt ?? seedPromptFor('eval_judge'));
  const cases = opts.cases ?? EVAL_CASES;
  let counter = 0;
  const gate = new EgressGate({
    provider: opts.provider,
    resolveModel: opts.resolveModel,
    posture: opts.posture,
    writeLog: (e) => opts.onLog?.(e),
    newRunId: () => `eval-${Date.now()}-${++counter}`,
  });
  const startedAt = new Date();
  const results: CaseResult[] = [];
  let modelSeen = '';
  for (const c of cases) {
    const t0 = Date.now();
    const r = await generatePlan(
      {
        gate,
        prompts: { plan_generation: planPrompt, guardrail_classifier: classifierPrompt, pattern_interpretation: planPrompt, review_narration: planPrompt },
        caseKey: null,
        denyNames: c.denyNames,
      },
      { intake: c.intake },
    );
    modelSeen = r.runs[0]?.model ?? modelSeen;
    const assertions = evaluateAssertions(c, r);
    let judge: JudgeOutput | null = null;
    let judgeError: string | null = null;
    if (judgePrompt && (r.status === 'succeeded' || r.status === 'rejected')) {
      const j = await judgePlan(gate, judgePrompt, { intake: c.intake, plan: r.output, expectations: c.expectations });
      if (j.ok) judge = j.output;
      else judgeError = j.reason === 'blocked_pii' ? 'judge input blocked by gate' : j.error;
    }
    const passed = assertions.every((a) => a.passed) && (judge ? judge.overallPass : true);
    results.push({ id: c.id, title: c.title, status: r.status, assertions, passed, judge, judgeError, runs: r.runs.length, latencyMs: Date.now() - t0 });
  }
  const rubricMeans: Record<string, number | null> = {};
  for (const crit of RUBRIC_CRITERIA) {
    const vals = results.flatMap((r) => r.judge?.scores.filter((s) => s.criterion === crit).map((s) => s.score) ?? []);
    rubricMeans[crit] = vals.length ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) / 100 : null;
  }
  const passedCases = results.filter((r) => r.passed).length;
  return {
    promptVersionId: planPrompt.id,
    model: modelSeen,
    provider: opts.provider.name,
    judgePromptVersionId: judgePrompt?.id ?? null,
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    cases: results,
    passedCases,
    totalCases: results.length,
    passed: passedCases === results.length,
    rubricMeans,
  };
}

export function formatReport(r: EvalReport): string {
  const lines: string[] = [];
  lines.push(`Eval: ${r.promptVersionId} on ${r.model || r.provider} — ${r.passedCases}/${r.totalCases} passed ${r.passed ? '✔' : '✘'}`);
  for (const c of r.cases) {
    lines.push(`  [${c.passed ? 'PASS' : 'FAIL'}] ${c.id} ${c.title} (${c.status}, ${c.latencyMs}ms)`);
    for (const a of c.assertions) if (!a.passed) lines.push(`      ✘ ${a.assertion}: ${a.detail}`);
    if (c.judge && !c.judge.overallPass) lines.push(`      ✘ judge: ${c.judge.summary}`);
    if (c.judgeError) lines.push(`      ! judge error: ${c.judgeError}`);
  }
  lines.push('  Rubric means: ' + Object.entries(r.rubricMeans).map(([k, v]) => `${k}=${v ?? '-'}`).join(' '));
  return lines.join('\n');
}
