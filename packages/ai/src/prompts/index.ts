import type { AiSurface, PromptVersion } from '@class-pulse/domain';
import { PLAN_GENERATION_V1 } from './plan_generation.v1';
import { PLAN_GENERATION_V2 } from './plan_generation.v2';
import { PLAN_GENERATION_V3 } from './plan_generation.v3';
import { PATTERN_INTERPRETATION_V1 } from './pattern_interpretation.v1';
import { REVIEW_NARRATION_V1 } from './review_narration.v1';
import { GUARDRAIL_CLASSIFIER_V1 } from './guardrail_classifier.v1';
import { EVAL_JUDGE_V1 } from './eval_judge.v1';

/**
 * The prompt registry seed (docs/03). Files are immutable; a new version is a new file with a
 * changelog. The API copies these into the prompt_versions table on first boot and promotion
 * happens there (gated on a passing eval run), so `status` here is only the initial state.
 *
 * `model: "default"` resolves from environment at call time (OPENAI_MODEL /
 * OPENAI_CLASSIFIER_MODEL) so a model upgrade is a config change that re-runs the evals, and a
 * pinned model id is still possible per version.
 */
export const PROMPT_SEEDS: ReadonlyArray<Omit<PromptVersion, 'createdAt'>> = [
  {
    id: 'plan_generation.v1',
    surface: 'plan_generation',
    version: 1,
    body: PLAN_GENERATION_V1,
    model: 'default',
    params: { reasoningEffort: null, maxTokens: 8000 },
    changelog:
      'Final Prompt from Applied Assignment 1 (docs/appendix-a), adapted to structured output. Replaces the V2 prompt which still allowed a numeric target from a combined "3–5 times" baseline.',
    createdBy: 'system',
    status: 'retired',
  },
  {
    id: 'plan_generation.v2',
    surface: 'plan_generation',
    version: 2,
    body: PLAN_GENERATION_V2,
    model: 'default',
    params: { reasoningEffort: null, maxTokens: 8000 },
    changelog:
      'From the first full v1 eval on gpt-5.6-terra (11/20): defines what counts as an available baseline (≥3 behavior-specific counts) so single observations and estimated ranges cannot carry a numeric target; confines diagnostic/disciplinary echoes to outOfScopeRequestNoted; asks each hypothesis to name an alternative explanation present in the input; allows empty strengths/patterns with a missingInformation entry.',
    createdBy: 'system',
    status: 'retired',
  },
  {
    id: 'plan_generation.v3',
    surface: 'plan_generation',
    version: 3,
    body: PLAN_GENERATION_V3,
    model: 'default',
    params: { reasoningEffort: null, maxTokens: 8000 },
    changelog:
      'From the v2 eval on gpt-5.6-terra (19/20): judge each goal\'s baseline independently so a behavior with its own three-plus counts can carry a proposed target; only name alternative explanations the input documents, never invent one.',
    createdBy: 'system',
    status: 'active',
  },
  {
    id: 'pattern_interpretation.v1',
    surface: 'pattern_interpretation',
    version: 1,
    body: PATTERN_INTERPRETATION_V1,
    model: 'default',
    params: { reasoningEffort: null, maxTokens: 4000 },
    changelog: 'Initial interpretation prompt: evidence-first, one labelled hypothesis, every confounder addressed, whatWouldConfirm per intervention.',
    createdBy: 'system',
    status: 'active',
  },
  {
    id: 'review_narration.v1',
    surface: 'review_narration',
    version: 1,
    body: REVIEW_NARRATION_V1,
    model: 'default',
    params: { reasoningEffort: null, maxTokens: 2500 },
    changelog: 'Initial narration prompt: three audiences, decision fixed by the engine.',
    createdBy: 'system',
    status: 'active',
  },
  {
    id: 'guardrail_classifier.v1',
    surface: 'guardrail_classifier',
    version: 1,
    body: GUARDRAIL_CLASSIFIER_V1,
    model: 'default',
    params: { reasoningEffort: 'low', maxTokens: 800 },
    changelog: 'Initial four-dimension classifier with confidence.',
    createdBy: 'system',
    status: 'active',
  },
  {
    id: 'eval_judge.v1',
    surface: 'eval_judge',
    version: 1,
    body: EVAL_JUDGE_V1,
    model: 'default',
    params: { reasoningEffort: 'medium', maxTokens: 3000 },
    changelog: 'Initial judge over the 11 source-assignment criteria.',
    createdBy: 'system',
    status: 'active',
  },
];

export function seedPromptFor(surface: AiSurface, version?: number): Omit<PromptVersion, 'createdAt'> {
  const candidates = PROMPT_SEEDS.filter((p) => p.surface === surface);
  const found = version ? candidates.find((p) => p.version === version) : candidates.find((p) => p.status === 'active') ?? candidates[candidates.length - 1];
  if (!found) throw new Error(`No prompt seed for surface ${surface}`);
  return found;
}

export { PLAN_GENERATION_V1, PATTERN_INTERPRETATION_V1, REVIEW_NARRATION_V1, GUARDRAIL_CLASSIFIER_V1, EVAL_JUDGE_V1 };
