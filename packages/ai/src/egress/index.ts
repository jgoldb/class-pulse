import type { AiSurface, PromptVersion } from '@class-pulse/domain';
import { OpenAIProvider } from './openai';
import { MockProvider, type MockScenario } from './mock';
import type { ModelProvider, ReasoningEffort } from './provider';
import type { ModelResolution } from './gate';

export * from './provider';
export * from './gate';
export { MockProvider, type MockScenario } from './mock';
export { OpenAIProvider } from './openai';

export interface AiEnv {
  AI_PROVIDER?: string;
  OPENAI_API_KEY?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  OPENAI_REASONING_EFFORT?: string;
  OPENAI_CLASSIFIER_MODEL?: string;
  OPENAI_CLASSIFIER_REASONING_EFFORT?: string;
  OPENAI_MAX_OUTPUT_TOKENS?: string;
  OPENAI_ZERO_RETENTION?: string;
  OPENAI_REGION?: string;
  MOCK_SCENARIO?: string;
}

export const DEFAULT_MODEL = 'gpt-5.6-terra';
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = 'medium';
export const DEFAULT_CLASSIFIER_EFFORT: ReasoningEffort = 'low';

const EFFORTS: ReasoningEffort[] = ['minimal', 'low', 'medium', 'high'];

function effort(v: string | undefined, fallback: ReasoningEffort): ReasoningEffort {
  return EFFORTS.includes(v as ReasoningEffort) ? (v as ReasoningEffort) : fallback;
}

export interface AiConfig {
  provider: 'openai' | 'mock';
  model: string;
  reasoningEffort: ReasoningEffort;
  classifierModel: string;
  classifierReasoningEffort: ReasoningEffort;
  maxOutputTokens: number;
  posture: { zeroRetention: boolean; region: string };
}

export function aiConfigFromEnv(env: AiEnv = process.env as AiEnv): AiConfig {
  const model = env.OPENAI_MODEL?.trim() || DEFAULT_MODEL;
  // The mock provider is a test double, honoured only under NODE_ENV=test. Everything else is the real model.
  const testMode = (env as NodeJS.ProcessEnv).NODE_ENV === 'test';
  return {
    provider: testMode && env.AI_PROVIDER === 'mock' ? 'mock' : 'openai',
    model,
    reasoningEffort: effort(env.OPENAI_REASONING_EFFORT, DEFAULT_REASONING_EFFORT),
    classifierModel: env.OPENAI_CLASSIFIER_MODEL?.trim() || model,
    classifierReasoningEffort: effort(env.OPENAI_CLASSIFIER_REASONING_EFFORT, DEFAULT_CLASSIFIER_EFFORT),
    maxOutputTokens: Number(env.OPENAI_MAX_OUTPUT_TOKENS) > 0 ? Number(env.OPENAI_MAX_OUTPUT_TOKENS) : 8000,
    posture: { zeroRetention: env.OPENAI_ZERO_RETENTION !== 'false', region: env.OPENAI_REGION?.trim() || 'us' },
  };
}

export function providerFromEnv(env: AiEnv = process.env as AiEnv): ModelProvider {
  const cfg = aiConfigFromEnv(env);
  if (cfg.provider === 'openai') {
    return new OpenAIProvider({
      apiKey: env.OPENAI_API_KEY ?? '',
      baseURL: env.OPENAI_BASE_URL || null,
      zeroRetention: cfg.posture.zeroRetention,
      region: cfg.posture.region,
    });
  }
  return new MockProvider((env.MOCK_SCENARIO as MockScenario) || 'default');
}

/**
 * Resolve the model for a call. `PromptVersion.model === "default"` means "whatever the
 * environment says for this surface"; a pinned id wins. Reasoning effort follows the same rule.
 */
export function modelResolverFromConfig(cfg: AiConfig) {
  return (surface: AiSurface, prompt: Pick<PromptVersion, 'model' | 'params'>): ModelResolution => {
    const cheap = surface === 'guardrail_classifier' || surface === 'eval_judge';
    const model = prompt.model && prompt.model !== 'default' ? prompt.model : cheap ? cfg.classifierModel : cfg.model;
    const reasoningEffort = prompt.params.reasoningEffort ?? (cheap ? cfg.classifierReasoningEffort : cfg.reasoningEffort);
    const maxTokens = Math.min(prompt.params.maxTokens, cfg.maxOutputTokens);
    return { model, reasoningEffort, maxTokens };
  };
}
