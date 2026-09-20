import { z } from 'zod';
import { IntakeFields, InterventionProposal, PlanContent, ReviewNarrative, ComputedRecommendation, PatternRouting } from '@class-pulse/domain';

/**
 * Allowlisted request payloads (docs/04 "Allowlist serialization"). The egress gate serializes
 * ONLY these shapes — never an entity. A field added to a table later cannot ride along.
 */
export const PlanGenerationPayload = z.object({
  intake: IntakeFields,
});
export type PlanGenerationPayload = z.infer<typeof PlanGenerationPayload>;

export const EvidenceSummary = z.object({
  signalType: z.string(),
  count: z.number().int(),
  distinctDays: z.number().int(),
  spanDays: z.number().int(),
  contextTags: z.array(z.string()),
  mean: z.number().nullable(),
  /** Per-context breakdown, e.g. { independent: { count, mean }, group_work: { count, mean } } */
  byContext: z.array(z.object({ tag: z.string(), count: z.number().int(), mean: z.number().nullable() })),
});
export type EvidenceSummary = z.infer<typeof EvidenceSummary>;

export const PatternInterpretationPayload = z.object({
  definition: z.object({ id: z.string(), version: z.number().int(), title: z.string(), plainLanguage: z.string() }),
  measures: z.record(z.string(), z.number()),
  evidence: z.array(EvidenceSummary),
  confounders: z.array(z.string()),
  strengths: z.array(z.string()),
  activeStrategies: z.array(z.object({ kind: z.string(), description: z.string() })),
  routing: PatternRouting,
  gradeLevel: z.string(),
});
export type PatternInterpretationPayload = z.infer<typeof PatternInterpretationPayload>;

export const ReviewNarrationPayload = z.object({
  computed: ComputedRecommendation,
  goals: z.array(z.object({ targetBehavior: z.string(), observableDefinition: z.string() })),
  gradeLevel: z.string(),
});
export type ReviewNarrationPayload = z.infer<typeof ReviewNarrationPayload>;

export const ClassifierPayload = z.object({
  surface: z.string(),
  draft: z.string(),
});
export type ClassifierPayload = z.infer<typeof ClassifierPayload>;

export const JudgePayload = z.object({
  intake: IntakeFields,
  plan: PlanContent,
  expectations: z.array(z.string()),
});
export type JudgePayload = z.infer<typeof JudgePayload>;

// ---- Output schemas -------------------------------------------------------------------------

export const ClassifierOutput = z.object({
  unsupportedCausalClaims: z.number().min(0).max(1),
  hypothesesStatedAsFact: z.number().min(0).max(1),
  stigmatizingLanguage: z.number().min(0).max(1),
  outsideEducationalScope: z.number().min(0).max(1),
  confidence: z.number().min(0).max(1),
  notes: z.string(),
});
export type ClassifierOutput = z.infer<typeof ClassifierOutput>;

export const RUBRIC_CRITERIA = [
  'accurate',
  'relevant',
  'clearAndOrganized',
  'observableAndMeasurable',
  'personalizedWithoutAssumptions',
  'practical',
  'supportiveNotPunitive',
  'privacyConscious',
  'transparentAboutUncertainty',
  'workloadReducing',
  'appropriateForHumanReview',
] as const;
export type RubricCriterion = (typeof RUBRIC_CRITERIA)[number];

export const JudgeOutput = z.object({
  scores: z.array(
    z.object({
      criterion: z.enum(RUBRIC_CRITERIA),
      score: z.number().int().min(1).max(5),
      justification: z.string(),
    }),
  ),
  overallPass: z.boolean(),
  summary: z.string(),
});
export type JudgeOutput = z.infer<typeof JudgeOutput>;

export const OUTPUT_SCHEMAS = {
  plan_generation: { name: 'behavior_support_plan', schema: PlanContent },
  pattern_interpretation: { name: 'intervention_proposal', schema: InterventionProposal },
  review_narration: { name: 'review_narrative', schema: ReviewNarrative },
  guardrail_classifier: { name: 'guardrail_scores', schema: ClassifierOutput },
  eval_judge: { name: 'rubric_scores', schema: JudgeOutput },
} as const;

// ---- JSON schema for strict structured output ---------------------------------------------

const STRIP_KEYS = new Set([
  'minLength', 'maxLength', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf',
  'minItems', 'maxItems', 'pattern', 'format', '$schema', 'default', 'uniqueItems',
]);

function strictify(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(strictify);
  if (typeof node !== 'object' || node === null) return node;
  const obj = { ...(node as Record<string, unknown>) };
  for (const k of Object.keys(obj)) if (STRIP_KEYS.has(k)) delete obj[k];
  if ('const' in obj) {
    obj.enum = [obj.const];
    delete obj.const;
  }
  // OpenAI strict mode supports anyOf but not oneOf; Zod emits oneOf for discriminated unions.
  if (Array.isArray(obj.oneOf)) {
    obj.anyOf = obj.oneOf;
    delete obj.oneOf;
  }
  if (obj.type === 'object' && obj.properties && typeof obj.properties === 'object') {
    obj.additionalProperties = false;
    obj.required = Object.keys(obj.properties as Record<string, unknown>);
  }
  for (const k of Object.keys(obj)) obj[k] = strictify(obj[k]);
  return obj;
}

/**
 * Convert a Zod schema into the JSON Schema dialect OpenAI strict mode accepts: every property
 * required, additionalProperties false, no value constraints (Zod re-validates after parsing).
 */
export function toStructuredJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'output', unrepresentable: 'any' });
  return strictify(raw) as Record<string, unknown>;
}
