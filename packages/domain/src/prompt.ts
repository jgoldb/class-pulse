import { z } from 'zod';

export const AI_SURFACES = ['plan_generation', 'pattern_interpretation', 'review_narration', 'guardrail_classifier', 'eval_judge'] as const;
export const AiSurface = z.enum(AI_SURFACES);
export type AiSurface = z.infer<typeof AiSurface>;

/** docs/03 — prompts are versioned application code. Immutable once created; exactly one active per surface. */
export const PromptVersion = z.object({
  id: z.string(),
  surface: AiSurface,
  version: z.number().int().positive(),
  body: z.string().min(1),
  /** Model id, or the literal "default" to resolve from environment at call time. */
  model: z.string().min(1),
  params: z.object({
    /** Reasoning effort for reasoning models; temperature is not exposed by reasoning models. */
    reasoningEffort: z.enum(['minimal', 'low', 'medium', 'high']).nullable(),
    maxTokens: z.number().int().positive(),
  }),
  changelog: z.string(),
  createdBy: z.string(),
  createdAt: z.coerce.date(),
  status: z.enum(['draft', 'active', 'retired']),
});
export type PromptVersion = z.infer<typeof PromptVersion>;

export const GENERATION_STATUSES = ['queued', 'running', 'succeeded', 'rejected', 'failed', 'blocked_pii'] as const;
export const GenerationStatus = z.enum(GENERATION_STATUSES);
export type GenerationStatus = z.infer<typeof GenerationStatus>;

export const GenerationRun = z.object({
  id: z.string(),
  surface: AiSurface,
  caseKey: z.string().nullable(),
  promptVersionId: z.string(),
  model: z.string(),
  provider: z.string(),
  inputHash: z.string(),
  latencyMs: z.number().int().nullable(),
  tokens: z.object({ input: z.number().int(), output: z.number().int(), reasoning: z.number().int() }).nullable(),
  status: GenerationStatus,
  attempt: z.number().int().positive(),
  error: z.string().nullable(),
  createdAt: z.coerce.date(),
});
export type GenerationRun = z.infer<typeof GenerationRun>;

export const GuardrailSeverity = z.enum(['reject', 'flag']);
export const GuardrailFinding = z.object({
  check: z.string(),
  severity: GuardrailSeverity,
  path: z.string(),
  message: z.string(),
});
export type GuardrailFinding = z.infer<typeof GuardrailFinding>;

export const GuardrailResult = z.object({
  passed: z.boolean(),
  findings: z.array(GuardrailFinding),
  classifier: z
    .object({
      model: z.string(),
      unsupportedCausalClaims: z.number().min(0).max(1),
      hypothesesStatedAsFact: z.number().min(0).max(1),
      stigmatizingLanguage: z.number().min(0).max(1),
      outsideEducationalScope: z.number().min(0).max(1),
      confidence: z.number().min(0).max(1),
      notes: z.string(),
    })
    .nullable(),
});
export type GuardrailResult = z.infer<typeof GuardrailResult>;
