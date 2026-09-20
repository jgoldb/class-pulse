import { z } from 'zod';
import { GoalContent } from './goal';
import { StrategyContent } from './strategy';
import { ReviewCriterion } from './review';

export const DASHBOARD_AUDIENCES = ['teacher', 'student', 'parent_guardian', 'administration'] as const;
export const DashboardAudience = z.enum(DASHBOARD_AUDIENCES);
export type DashboardAudience = z.infer<typeof DashboardAudience>;

/**
 * The structured behavior-support plan. Mirrors the 16 output sections of the source prompt
 * (docs/appendix-a) with sections 5, 12, 13 and 14 as structured arrays (docs/03).
 *
 * This schema is shared by the API, the web app and the model's structured-output format, so a
 * change here cannot pass type-check in only half the system.
 *
 * Structured-output note: OpenAI strict mode requires every property to be required and forbids
 * `additionalProperties`; nullable is used instead of optional throughout.
 */
export const PlanContent = z.object({
  /** 1. Behavioral Concern — neutral, observable language */
  behavioralConcern: z.string().min(1),
  /** 2. Student Strengths */
  studentStrengths: z.array(z.string().min(1)),
  /** 3. Documented Patterns — only what the input documents */
  documentedPatterns: z.array(z.string().min(1)),
  /** 4. Hypotheses to Monitor — explicitly labelled, non-causal */
  hypothesesToMonitor: z.array(
    z.object({
      hypothesis: z.string().min(1),
      whatToObserve: z.string().min(1),
    }),
  ),
  /** 5. Measurable Behavior Goals */
  measurableGoals: z.array(GoalContent),
  /** 6. Replacement Behaviors */
  replacementBehaviors: z.array(
    z.object({
      behavior: z.string().min(1),
      howToTeach: z.string().min(1),
      replaces: z.string().min(1),
    }),
  ),
  /** 7. Preventive Strategies */
  preventiveStrategies: z.array(StrategyContent),
  /** 8. Teacher Response Strategies */
  teacherResponseStrategies: z.array(StrategyContent),
  /** 9. Student Self-Monitoring */
  studentSelfMonitoring: z.array(StrategyContent),
  /** 10. Parent/Guardian Support */
  parentGuardianSupport: z.array(StrategyContent),
  /** 11. Low-Workload Progress Monitoring */
  progressMonitoring: z.array(
    z.object({
      what: z.string().min(1),
      method: z.string().min(1),
      frequency: z.string().min(1),
      estimatedMinutesPerDay: z.number().min(0).max(60),
    }),
  ),
  /** 12. Dashboard Recommendations */
  dashboardRecommendations: z.array(
    z.object({
      audience: DashboardAudience,
      include: z.array(z.string().min(1)),
    }),
  ),
  /** 13. Information That Should Not Be Displayed — design-time input to the policy layer, never runtime authorization */
  informationNotToDisplay: z.array(
    z.object({
      audience: DashboardAudience,
      exclude: z.array(z.string().min(1)),
    }),
  ),
  /** 14. Plan Review and Revision Criteria — becomes rules evaluated by the review-cycle engine */
  reviewCriteria: z.array(ReviewCriterion),
  /** 15. Missing Information */
  missingInformation: z.array(z.string().min(1)),
  /** 16. Privacy and Human-Review Notes */
  privacyAndHumanReviewNotes: z.object({
    privacyNotes: z.array(z.string().min(1)),
    humanReviewRequired: z.array(z.string().min(1)),
    outOfScopeRequestNoted: z.string().nullable(),
    safetyConcern: z.boolean(),
    safetyNote: z.string().nullable(),
  }),
});
export type PlanContent = z.infer<typeof PlanContent>;

export const PLAN_SECTIONS: Array<{ key: keyof PlanContent; number: number; title: string }> = [
  { key: 'behavioralConcern', number: 1, title: 'Behavioral Concern' },
  { key: 'studentStrengths', number: 2, title: 'Student Strengths' },
  { key: 'documentedPatterns', number: 3, title: 'Documented Patterns' },
  { key: 'hypothesesToMonitor', number: 4, title: 'Hypotheses to Monitor' },
  { key: 'measurableGoals', number: 5, title: 'Measurable Behavior Goals' },
  { key: 'replacementBehaviors', number: 6, title: 'Replacement Behaviors' },
  { key: 'preventiveStrategies', number: 7, title: 'Preventive Strategies' },
  { key: 'teacherResponseStrategies', number: 8, title: 'Teacher Response Strategies' },
  { key: 'studentSelfMonitoring', number: 9, title: 'Student Self-Monitoring' },
  { key: 'parentGuardianSupport', number: 10, title: 'Parent/Guardian Support' },
  { key: 'progressMonitoring', number: 11, title: 'Low-Workload Progress Monitoring' },
  { key: 'dashboardRecommendations', number: 12, title: 'Dashboard Recommendations' },
  { key: 'informationNotToDisplay', number: 13, title: 'Information That Should Not Be Displayed' },
  { key: 'reviewCriteria', number: 14, title: 'Plan Review and Revision Criteria' },
  { key: 'missingInformation', number: 15, title: 'Missing Information' },
  { key: 'privacyAndHumanReviewNotes', number: 16, title: 'Privacy and Human-Review Notes' },
];

/**
 * Sections that must be non-empty for a draft to pass deterministic guardrails.
 * `studentStrengths` and `documentedPatterns` are deliberately NOT here: when the intake
 * documents none, an empty list is the honest answer ("do not invent information"); guardrails
 * flag it and require a missingInformation entry instead.
 */
export const REQUIRED_NONEMPTY_SECTIONS: Array<keyof PlanContent> = [
  'behavioralConcern',
  'measurableGoals',
  'replacementBehaviors',
  'preventiveStrategies',
  'teacherResponseStrategies',
  'progressMonitoring',
  'dashboardRecommendations',
  'informationNotToDisplay',
  'reviewCriteria',
  'missingInformation',
];

// ---- Plan lifecycle -------------------------------------------------------------------------

export const PLAN_STATUSES = [
  'draft',
  'in_review',
  'active',
  'under_review',
  'continued',
  'modified',
  'faded',
  'discontinued',
] as const;
export const PlanStatus = z.enum(PLAN_STATUSES);
export type PlanStatus = z.infer<typeof PlanStatus>;

/** docs/01: draft → in_review → active → under_review → (continued | modified | faded | discontinued) */
export const PLAN_TRANSITIONS: Record<PlanStatus, readonly PlanStatus[]> = {
  draft: ['in_review'],
  in_review: ['active', 'draft'],
  active: ['under_review'],
  under_review: ['continued', 'modified', 'faded', 'discontinued'],
  // `continued` and `modified` return the plan to active service; faded/discontinued are terminal.
  continued: ['active'],
  modified: ['active'],
  faded: [],
  discontinued: [],
};

/** Transitions that require an approval-capable role (docs/01: "only a named human"). */
export const APPROVAL_TRANSITIONS: ReadonlyArray<[PlanStatus, PlanStatus]> = [
  ['in_review', 'active'],
  ['under_review', 'continued'],
  ['under_review', 'modified'],
  ['under_review', 'faded'],
  ['under_review', 'discontinued'],
];

export function canTransitionPlan(from: PlanStatus, to: PlanStatus): boolean {
  return PLAN_TRANSITIONS[from].includes(to);
}

export function isApprovalTransition(from: PlanStatus, to: PlanStatus): boolean {
  return APPROVAL_TRANSITIONS.some(([f, t]) => f === from && t === to);
}

export const PlanTransitionRecord = z.object({
  from: PlanStatus,
  to: PlanStatus,
  actorUserId: z.string(),
  at: z.coerce.date(),
  rationale: z.string().nullable(),
});
export type PlanTransitionRecord = z.infer<typeof PlanTransitionRecord>;
