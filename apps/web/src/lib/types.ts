import type { Baseline, GoalTarget, GuardrailResult, InterventionProposal, PlanContent, ReviewNarrative, ComputedRecommendation } from '@class-pulse/domain';

export interface CaseListItem {
  caseKey: string;
  gradeLevel: string;
  status: string;
  sectionId: string;
  role: string;
  plan: { id: string; status: string; updatedAt: string } | null;
  latestDraft: { id: string; status: string } | null;
  createdAt: string;
}

export interface RosterStudent {
  id: string;
  displayName: string;
  gradeLevel: string;
  sectionId: string;
  sectionName: string;
  caseKeys: string[];
}

export interface Draft {
  id: string;
  caseKey: string;
  intakeId: string;
  status: string;
  content: PlanContent | null;
  guardrails: GuardrailResult | null;
  error: string | null;
  piiSpans: Array<{ kind: string; text: string; hint: string }> | null;
  createdAt: string;
}

export interface ProgressSeries {
  goalId: string;
  targetBehavior: string;
  direction: 'increase' | 'decrease';
  measurementMethod: string;
  unit: string;
  baseline: Baseline;
  target: GoalTarget;
  points: Array<{ date: string; value: number; observations: number }>;
  totalObservations: number;
  preBaseline: boolean;
  selfChecks: Array<{ date: string; value: number }>;
}

export interface GoalView {
  id: string;
  status: string;
  targetBehavior: string;
  observableDefinition: string;
  direction: 'increase' | 'decrease';
  reviewPeriodDays: number;
  measurementMethod: string;
  baseline?: Baseline;
  baselineStatus?: string;
  target?: GoalTarget;
  progress?: ProgressSeries;
  progressSummary?: { totalObservations: number; preBaseline: boolean; lastEntry: string | null };
  accomplishments?: string[];
}

export interface StrategyView {
  id: string;
  kind: string;
  description: string;
  rationale: string;
  usesStrengths: string[];
  effortLevel: string;
}

export interface ReviewCycleView {
  id: string;
  dueAt: string;
  status: string;
  decision?: string | null;
  decidedAt?: string | null;
  computed?: ComputedRecommendation | null;
  rationale?: string | null;
  narrativeStatus?: string | null;
  narrativeTeacher?: { summary: string; suggestedAdjustments: string[]; humanReviewNotes: string };
  narrativeStudent?: string;
  narrativeFamily?: string;
}

export interface CaseView {
  role: string;
  fields: string[];
  case_caseKey?: string;
  case_gradeLevel?: string;
  case_status?: string;
  intake_fields?: { version: number; fields: Record<string, string>; createdAt: string } | null;
  planId?: string;
  plan_status?: string;
  plan_provenance?: { aiDrafted: boolean; promptVersionId: string | null; approvedBy: string | null; approvedAt: string | null; version: number; transitions?: unknown[] };
  plan_draftDiff?: { entries: unknown[]; bySection: Record<string, { changed: number; added: number; removed: number }> } | null;
  goals?: GoalView[];
  strategies?: StrategyView[];
  reviewCycles?: ReviewCycleView[];
  signal_behaviorEvents?: unknown[];
  signal_behaviorEventNotes?: Array<{ id: string; observedAt: string; note: string }>;
  signal_strategyUse?: unknown[];
  signal_selfChecks?: Array<{ id: string; value: number; observedAt: string }>;
  pattern_candidates?: Array<{ id: string; definitionId: string; title: string; status: string; strength: number; routing: string; detectedAt: string; proposalStatus: string }>;
  pattern_confirmedPlainLanguage?: Array<{ id: string; title: string; plainLanguage: string; confirmedAt: string | null; evidence?: { observations: number; measures: Record<string, number> } }>;
  safety_flags?: Array<{ id: string; description: string; status: string; source: string; createdAt: string }>;
  correctionRequests?: Array<{ id: string; subject: string; detail: string; status: string; resolutionNote: string | null; createdAt: string }>;
  dataCollectedExplanation?: { whatIsCollected: string[]; why: string; whatIsNotCollected: string[]; aiRole: string };
  student?: { id: string; displayName: string };
  [key: string]: unknown;
}

export interface Candidate {
  id: string;
  caseKey: string;
  definitionId: string;
  definitionVersion: number;
  title: string;
  plainLanguage: string;
  confounders: string[];
  status: string;
  strength: number;
  evidenceRefs: string[];
  measures: Record<string, number>;
  routing: string;
  proposal: InterventionProposal | null;
  proposalStatus: string;
  proposalGuardrails: GuardrailResult | null;
  detectedAt: string;
  adjudicatedAt: string | null;
  dismissalReason: string | null;
  adjudicationNote: string | null;
  evidence?: Array<{ signalType: string; count: number; distinctDays: number; spanDays: number; contextTags: string[]; mean: number | null; byContext: Array<{ tag: string; count: number; mean: number | null }> }>;
  evidenceSignals?: Array<{ id: string; type: string; value: number | string; contextTags: string[]; observedAt: string }>;
}

export interface ReviewCycleFull {
  id: string;
  planId: string;
  caseKey: string;
  dueAt: string;
  status: string;
  computed: ComputedRecommendation | null;
  narrative: ReviewNarrative | null;
  narrativeStatus: string | null;
  decision: string | null;
  rationale: string | null;
}
