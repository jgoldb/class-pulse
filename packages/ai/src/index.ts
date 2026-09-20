import {
  InterventionProposal,
  PlanContent,
  ReviewNarrative,
  type ComputedRecommendation,
  type GuardrailResult,
  type PatternRouting,
  type PromptVersion,
} from '@class-pulse/domain';
import { EgressGate, type EgressOutcome, type RunMeta } from './egress/gate';
import {
  ClassifierOutput,
  ClassifierPayload,
  JudgeOutput,
  JudgePayload,
  OUTPUT_SCHEMAS,
  PatternInterpretationPayload,
  PlanGenerationPayload,
  ReviewNarrationPayload,
} from './schema';
import { checkNarrativeDeterministic, checkPlanDeterministic, checkProposalDeterministic, combine } from './guardrails';

export * from './egress';
export * from './schema';
export * from './guardrails';
export * from './prompts';
export * from './pii';

type PromptRef = Pick<PromptVersion, 'id' | 'body' | 'model' | 'params' | 'version'>;

export interface GenerationContext {
  gate: EgressGate;
  /** Active prompt versions by surface, loaded by the caller from the registry table. */
  prompts: {
    plan_generation: PromptRef;
    pattern_interpretation: PromptRef;
    review_narration: PromptRef;
    guardrail_classifier: PromptRef;
  };
  caseKey?: string | null;
  denyNames?: ReadonlyArray<string>;
  /** Set false to skip the model-based classifier (e.g. in unit tests). Default true. */
  classify?: boolean;
}

export type GenerationResult<T> =
  | { status: 'succeeded'; output: T; guardrails: GuardrailResult; runs: RunMeta[]; attempts: number }
  | { status: 'rejected'; output: T; guardrails: GuardrailResult; runs: RunMeta[]; attempts: number }
  | { status: 'blocked_pii'; spans: EgressOutcome<T> extends infer _ ? Array<{ kind: string; text: string; hint: string }> : never; runs: RunMeta[]; attempts: number }
  | { status: 'failed'; error: string; runs: RunMeta[]; attempts: number };

/** The model-based second check (docs/03). Never called with identifiers: it sees the draft only. */
async function classify(ctx: GenerationContext, surface: string, draft: unknown): Promise<{ model: string; output: ClassifierOutput; run: RunMeta } | null> {
  if (ctx.classify === false) return null;
  const res = await ctx.gate.call({
    surface: 'guardrail_classifier',
    promptVersion: ctx.prompts.guardrail_classifier,
    payloadSchema: ClassifierPayload,
    payload: { surface, draft: JSON.stringify(draft) },
    outputSchema: ClassifierOutput,
    schemaName: OUTPUT_SCHEMAS.guardrail_classifier.name,
    caseKey: ctx.caseKey ?? null,
    denyNames: ctx.denyNames,
  });
  if (!res.ok) return null; // classifier failure is not a generation failure; deterministic checks still apply
  return { model: res.run.model, output: res.output, run: res.run };
}

/**
 * Generate → validate → guardrails → (regenerate once on rejection) → result.
 * docs/03: "Nothing fails silently. A rejected generation either regenerates once or surfaces to
 * the reviewer marked as needing attention."
 */
async function generateWithGuardrails<TPayload, TOut>(
  ctx: GenerationContext,
  call: {
    surface: 'plan_generation' | 'pattern_interpretation' | 'review_narration';
    promptVersion: PromptRef;
    payloadSchema: Parameters<EgressGate['call']>[0]['payloadSchema'];
    payload: TPayload;
    outputSchema: Parameters<EgressGate['call']>[0]['outputSchema'];
    schemaName: string;
    deterministic: (out: TOut) => ReturnType<typeof checkPlanDeterministic>;
  },
): Promise<GenerationResult<TOut>> {
  const runs: RunMeta[] = [];
  let last: { output: TOut; guardrails: GuardrailResult } | null = null;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const res = (await ctx.gate.call({
      surface: call.surface,
      promptVersion: call.promptVersion,
      payloadSchema: call.payloadSchema as never,
      payload: call.payload as never,
      outputSchema: call.outputSchema as never,
      schemaName: call.schemaName,
      caseKey: ctx.caseKey ?? null,
      denyNames: ctx.denyNames,
    })) as EgressOutcome<TOut>;
    runs.push(res.run);
    if (!res.ok) {
      if (res.reason === 'blocked_pii') {
        return { status: 'blocked_pii', spans: res.spans.map((s) => ({ kind: s.kind, text: s.text, hint: s.hint })), runs, attempts: attempt } as GenerationResult<TOut>;
      }
      if (res.retryable && attempt === 1) continue;
      return { status: 'failed', error: res.error, runs, attempts: attempt };
    }
    const deterministic = call.deterministic(res.output);
    const cls = await classify(ctx, call.surface, res.output);
    if (cls) runs.push(cls.run);
    const guardrails = combine(deterministic, cls ? { model: cls.model, output: cls.output } : null);
    last = { output: res.output, guardrails };
    if (guardrails.passed) return { status: 'succeeded', output: res.output, guardrails, runs, attempts: attempt };
  }
  return { status: 'rejected', output: last!.output, guardrails: last!.guardrails, runs, attempts: 2 };
}

export function generatePlan(ctx: GenerationContext, payload: PlanGenerationPayload): Promise<GenerationResult<PlanContent>> {
  return generateWithGuardrails<PlanGenerationPayload, PlanContent>(ctx, {
    surface: 'plan_generation',
    promptVersion: ctx.prompts.plan_generation,
    payloadSchema: PlanGenerationPayload,
    payload,
    outputSchema: PlanContent,
    schemaName: OUTPUT_SCHEMAS.plan_generation.name,
    deterministic: checkPlanDeterministic,
  });
}

export function interpretPattern(ctx: GenerationContext, payload: PatternInterpretationPayload): Promise<GenerationResult<InterventionProposal>> {
  return generateWithGuardrails<PatternInterpretationPayload, InterventionProposal>(ctx, {
    surface: 'pattern_interpretation',
    promptVersion: ctx.prompts.pattern_interpretation,
    payloadSchema: PatternInterpretationPayload,
    payload,
    outputSchema: InterventionProposal,
    schemaName: OUTPUT_SCHEMAS.pattern_interpretation.name,
    deterministic: (out) => checkProposalDeterministic(out, payload.confounders, payload.routing as PatternRouting),
  });
}

export function narrateReview(ctx: GenerationContext, payload: ReviewNarrationPayload): Promise<GenerationResult<ReviewNarrative>> {
  return generateWithGuardrails<ReviewNarrationPayload, ReviewNarrative>(ctx, {
    surface: 'review_narration',
    promptVersion: ctx.prompts.review_narration,
    payloadSchema: ReviewNarrationPayload,
    payload,
    outputSchema: ReviewNarrative,
    schemaName: OUTPUT_SCHEMAS.review_narration.name,
    deterministic: (out) => checkNarrativeDeterministic(out, payload.computed as ComputedRecommendation),
  });
}

/** Re-run guardrails on an educator-edited plan before approval (edits can reintroduce failures). */
export function checkEditedPlan(plan: PlanContent): GuardrailResult {
  return combine(checkPlanDeterministic(plan), null);
}

export async function judgePlan(gate: EgressGate, prompt: PromptRef, payload: JudgePayload): Promise<EgressOutcome<JudgeOutput>> {
  return gate.call({
    surface: 'eval_judge',
    promptVersion: prompt,
    payloadSchema: JudgePayload,
    payload,
    outputSchema: JudgeOutput,
    schemaName: OUTPUT_SCHEMAS.eval_judge.name,
    caseKey: null,
  });
}
