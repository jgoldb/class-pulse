import type { Role } from '@class-pulse/domain';

/**
 * docs/04 layer 2 — field visibility. A declarative map `field × role → visible | redacted |
 * aggregate_only`, pure and dependency-free, derived from section 13 of the source prompt.
 *
 * "Administration" here is the *default* administrator posture (aggregate only). An
 * administrator holding a live AuthorizationRecord for a specific student is elevated to the
 * `administrator_authorized` pseudo-role for that student and sees the support-professional view.
 */
export type Visibility = 'visible' | 'redacted' | 'aggregate_only';

export type PolicyRole = Role | 'administrator_authorized';

/** Every field that can leave the working plane through a role view model. */
export const CASE_FIELDS = [
  // case + intake
  'case.caseKey',
  'case.gradeLevel',
  'case.status',
  'intake.fields',
  // plan sections
  'plan.behavioralConcern',
  'plan.studentStrengths',
  'plan.documentedPatterns',
  'plan.hypothesesToMonitor',
  'plan.measurableGoals',
  'plan.replacementBehaviors',
  'plan.preventiveStrategies',
  'plan.teacherResponseStrategies',
  'plan.studentSelfMonitoring',
  'plan.parentGuardianSupport',
  'plan.progressMonitoring',
  'plan.dashboardRecommendations',
  'plan.informationNotToDisplay',
  'plan.reviewCriteria',
  'plan.missingInformation',
  'plan.privacyAndHumanReviewNotes',
  'plan.status',
  'plan.provenance', // AI-drafted flag, prompt version, approver, approval time
  'plan.draftDiff',
  // goals / progress
  'goal.definition',
  'goal.baseline',
  'goal.target',
  'goal.progressSeries',
  'goal.progressSummary', // coarse: improving / flat / needs more data
  'goal.accomplishments',
  // signals
  'signal.behaviorEvents',
  'signal.behaviorEventNotes', // teacher free text
  'signal.grades',
  'signal.attendance',
  'signal.strategyUse',
  'signal.selfChecks',
  // patterns
  'pattern.candidates', // raw, including detected/in_review
  'pattern.confirmedPlainLanguage',
  'pattern.evidence',
  'pattern.proposal',
  'pattern.insufficientDataNotes',
  // review cycles
  'review.computed',
  'review.narrativeTeacher',
  'review.narrativeStudent',
  'review.narrativeFamily',
  'review.decision',
  // safety / admin
  'safety.flags',
  'generation.runMetadata',
  'audit.events',
] as const;
export type CaseField = (typeof CASE_FIELDS)[number];

const V = 'visible';
const R = 'redacted';
const A = 'aggregate_only';

type Matrix = Record<CaseField, Record<PolicyRole, Visibility>>;

// Column order: teacher, student, guardian, support_professional, administrator, administrator_authorized
function row(t: Visibility, s: Visibility, g: Visibility, sp: Visibility, ad: Visibility, aa: Visibility): Record<PolicyRole, Visibility> {
  return { teacher: t, student: s, guardian: g, support_professional: sp, administrator: ad, administrator_authorized: aa };
}

export const FIELD_MATRIX: Matrix = {
  'case.caseKey': row(V, V, V, V, A, V),
  'case.gradeLevel': row(V, V, V, V, A, V),
  'case.status': row(V, R, V, V, A, V),
  'intake.fields': row(V, R, R, V, R, V),

  'plan.behavioralConcern': row(V, R, V, V, R, V),
  'plan.studentStrengths': row(V, V, V, V, R, V),
  'plan.documentedPatterns': row(V, R, R, V, R, V),
  'plan.hypothesesToMonitor': row(V, R, R, V, R, V),
  'plan.measurableGoals': row(V, V, V, V, R, V),
  'plan.replacementBehaviors': row(V, V, V, V, R, V),
  'plan.preventiveStrategies': row(V, R, R, V, R, V),
  'plan.teacherResponseStrategies': row(V, R, R, V, R, V),
  'plan.studentSelfMonitoring': row(V, V, V, V, R, V),
  'plan.parentGuardianSupport': row(V, R, V, V, R, V),
  'plan.progressMonitoring': row(V, R, R, V, R, V),
  'plan.dashboardRecommendations': row(V, R, R, V, R, V),
  'plan.informationNotToDisplay': row(V, R, R, V, R, V),
  'plan.reviewCriteria': row(V, R, R, V, R, V),
  'plan.missingInformation': row(V, R, R, V, R, V),
  'plan.privacyAndHumanReviewNotes': row(V, R, R, V, R, V),
  'plan.status': row(V, V, V, V, A, V),
  'plan.provenance': row(V, V, V, V, A, V),
  'plan.draftDiff': row(V, R, R, V, A, V),

  'goal.definition': row(V, V, V, V, R, V),
  'goal.baseline': row(V, R, R, V, R, V),
  'goal.target': row(V, V, V, V, R, V),
  'goal.progressSeries': row(V, V, R, V, A, V),
  'goal.progressSummary': row(V, V, V, V, A, V),
  'goal.accomplishments': row(V, V, V, V, R, V),

  'signal.behaviorEvents': row(V, R, R, V, A, V),
  'signal.behaviorEventNotes': row(V, R, R, V, R, R),
  'signal.grades': row(V, R, R, V, A, V),
  'signal.attendance': row(V, R, R, V, A, V),
  'signal.strategyUse': row(V, V, R, V, A, V),
  'signal.selfChecks': row(V, V, R, V, A, V),

  'pattern.candidates': row(V, R, R, V, A, V),
  'pattern.confirmedPlainLanguage': row(V, R, V, V, A, V),
  'pattern.evidence': row(V, R, V, V, R, V),
  'pattern.proposal': row(V, R, R, V, R, V),
  'pattern.insufficientDataNotes': row(V, R, R, V, R, R),

  'review.computed': row(V, R, R, V, A, V),
  'review.narrativeTeacher': row(V, R, R, V, R, V),
  'review.narrativeStudent': row(V, V, R, V, R, V),
  'review.narrativeFamily': row(V, R, V, V, R, V),
  'review.decision': row(V, V, V, V, A, V),

  'safety.flags': row(V, R, R, V, R, V),
  'generation.runMetadata': row(V, R, R, V, A, V),
  'audit.events': row(R, R, R, R, V, V),
};

export function visibility(field: CaseField, role: PolicyRole): Visibility {
  return FIELD_MATRIX[field][role];
}

export function canSee(field: CaseField, role: PolicyRole): boolean {
  return visibility(field, role) === 'visible';
}

/** All fields a role may receive on an individual record. Used by view-model builders and by tests. */
export function visibleFields(role: PolicyRole): CaseField[] {
  return CASE_FIELDS.filter((f) => canSee(f, role));
}

export function hiddenFields(role: PolicyRole): CaseField[] {
  return CASE_FIELDS.filter((f) => !canSee(f, role));
}

/**
 * Invariants from docs/04 §"Field visibility" table, checked in tests:
 *  - student never sees raw candidates, teacher notes, or administrative content
 *  - guardian never sees teacher notes or raw candidates
 *  - administrator (unauthorized) sees no individual narrative field
 */
export const INVARIANTS: Array<{ role: PolicyRole; neverVisible: CaseField[] }> = [
  {
    role: 'student',
    neverVisible: [
      'pattern.candidates',
      'pattern.proposal',
      'signal.behaviorEventNotes',
      'intake.fields',
      'audit.events',
      'generation.runMetadata',
      'plan.privacyAndHumanReviewNotes',
      'plan.hypothesesToMonitor',
      'safety.flags',
    ],
  },
  {
    role: 'guardian',
    neverVisible: ['pattern.candidates', 'pattern.proposal', 'signal.behaviorEventNotes', 'intake.fields', 'audit.events', 'plan.hypothesesToMonitor'],
  },
  {
    role: 'administrator',
    neverVisible: [
      'intake.fields',
      'plan.behavioralConcern',
      'plan.hypothesesToMonitor',
      'signal.behaviorEventNotes',
      'pattern.proposal',
      'pattern.evidence',
      'review.narrativeTeacher',
      'safety.flags',
    ],
  },
  { role: 'teacher', neverVisible: ['audit.events'] },
];
