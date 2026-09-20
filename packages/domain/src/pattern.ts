import { z } from 'zod';
import { SignalType } from './signals';

export const PATTERN_ROUTINGS = ['teacher_review', 'support_team', 'safety_escalation'] as const;
export const PatternRouting = z.enum(PATTERN_ROUTINGS);
export type PatternRouting = z.infer<typeof PatternRouting>;

export const PATTERN_DEFINITION_STATUSES = ['piloting', 'active', 'retired'] as const;
export const PatternDefinitionStatus = z.enum(PATTERN_DEFINITION_STATUSES);
export type PatternDefinitionStatus = z.infer<typeof PatternDefinitionStatus>;

/**
 * The data half of a PatternDefinition (docs/02). The `detect` function lives with the
 * definition in packages/patterns; this metadata is what gets shown to educators and stored on
 * every candidate so a card can always say which rule, which version, fired on what.
 */
export const PatternDefinitionMeta = z.object({
  id: z.string().regex(/^[a-z][a-z0-9-]+$/),
  version: z.number().int().positive(),
  title: z.string().min(1),
  /** Shown verbatim to educators; no jargon. */
  plainLanguage: z.string().min(1),
  requiredSignals: z.object({
    types: z.array(SignalType),
    minObservations: z.number().int().nonnegative(),
    minDistinctDays: z.number().int().nonnegative(),
    minSpanDays: z.number().int().nonnegative(),
  }),
  /** Alternative explanations the interpretation MUST address. */
  confounders: z.array(z.string().min(1)),
  routing: PatternRouting,
  suppression: z.object({ cooldownDays: z.number().int().nonnegative(), maxActivePerStudent: z.number().int().positive() }),
  status: PatternDefinitionStatus,
  /** Thresholds are data so they can be reviewed and tuned (open question #5). */
  thresholds: z.record(z.string(), z.number()),
  /** Named reviewer required before a definition leaves `piloting` (open question #10). */
  reviewer: z.string().nullable(),
  /** Proxy review note (docs/02 equity guardrails): why this rule is not a demographic rule in disguise. */
  proxyReview: z.string(),
});
export type PatternDefinitionMeta = z.infer<typeof PatternDefinitionMeta>;

export const DetectionResult = z.object({
  fired: z.boolean(),
  /** 0–1 evidence weight — NOT a probability of truth. */
  strength: z.number().min(0).max(1),
  evidenceRefs: z.array(z.string()),
  measures: z.record(z.string(), z.number()),
  /** Present when the sufficiency gate blocked evaluation. */
  insufficientData: z
    .object({
      missing: z.array(z.string()),
    })
    .nullable(),
});
export type DetectionResult = z.infer<typeof DetectionResult>;

export const CANDIDATE_STATUSES = ['detected', 'in_review', 'confirmed', 'dismissed', 'needs_more_data', 'escalated'] as const;
export const CandidateStatus = z.enum(CANDIDATE_STATUSES);
export type CandidateStatus = z.infer<typeof CandidateStatus>;

/** docs/02: detected → in_review → confirmed | dismissed | needs_more_data | escalated */
export const CANDIDATE_TRANSITIONS: Record<CandidateStatus, readonly CandidateStatus[]> = {
  detected: ['in_review'],
  in_review: ['confirmed', 'dismissed', 'needs_more_data', 'escalated'],
  needs_more_data: ['in_review', 'dismissed'],
  confirmed: [],
  dismissed: [],
  escalated: ['in_review'], // re-opened by the support team queue
};

export function canTransitionCandidate(from: CandidateStatus, to: CandidateStatus): boolean {
  return CANDIDATE_TRANSITIONS[from].includes(to);
}

export const DISMISSAL_REASONS = ['not_accurate', 'already_known', 'not_actionable', 'wrong_framing', 'other'] as const;
export const DismissalReason = z.enum(DISMISSAL_REASONS);
export type DismissalReason = z.infer<typeof DismissalReason>;

/** LLM output for a fired candidate (docs/02 §2). */
export const InterventionProposal = z.object({
  evidenceRestatement: z.string().min(1),
  hypothesis: z.string().min(1),
  alternativeExplanations: z.array(z.object({ confounder: z.string().min(1), assessment: z.string().min(1) })),
  proposedInterventions: z.array(
    z.object({
      description: z.string().min(1),
      rationale: z.string().min(1),
      effortLevel: z.enum(['low', 'medium', 'high']),
      workloadJustification: z.string().nullable(),
      whatWouldConfirm: z.string().min(1),
    }),
  ),
  dataToCollect: z.array(z.string().min(1)),
  humanReviewNotes: z.string(),
});
export type InterventionProposal = z.infer<typeof InterventionProposal>;

export const PatternCandidate = z.object({
  id: z.string(),
  caseKey: z.string(),
  definitionId: z.string(),
  definitionVersion: z.number().int(),
  status: CandidateStatus,
  strength: z.number(),
  evidenceRefs: z.array(z.string()),
  measures: z.record(z.string(), z.number()),
  routing: PatternRouting,
  proposal: InterventionProposal.nullable(),
  proposalRunId: z.string().nullable(),
  detectedAt: z.coerce.date(),
  adjudicatedBy: z.string().nullable(),
  adjudicatedAt: z.coerce.date().nullable(),
  dismissalReason: DismissalReason.nullable(),
  adjudicationNote: z.string().nullable(),
  collectionTarget: z
    .object({ signalType: SignalType, additionalObservations: z.number().int().positive() })
    .nullable(),
  /** Piloting definitions detect and record but surface to no one. */
  visible: z.boolean(),
});
export type PatternCandidate = z.infer<typeof PatternCandidate>;
