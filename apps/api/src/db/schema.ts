import { sql } from 'drizzle-orm';
import type { ArtifactContent, ArtifactKind, ArtifactSource, ClassroomObservation, ContributionContent, PlanRevisionSource, TomorrowSchedule } from '@class-pulse/domain';
import { boolean, index, integer, jsonb, pgSchema, primaryKey, real, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Two data planes (docs/04). Identifying data and case content never live in the same row.
 * The only bridge is identified.case_links, which is access-controlled and audited.
 */
export const identified = pgSchema('identified');
export const working = pgSchema('working');

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

// ---- IDENTIFIED PLANE -----------------------------------------------------------------------

export const organizations = identified.table('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  pulseraEnabled: boolean('pulsera_enabled').notNull().default(false),
  /** Org-level extension of the controlled context-tag vocabulary. */
  contextTagExtensions: jsonb('context_tag_extensions').$type<Array<{ tag: string; dimension: string }>>().notNull().default(sql`'[]'::jsonb`),
});

export const schools = identified.table('schools', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  name: text('name').notNull(),
  timezone: text('timezone').notNull().default('UTC'),
});

export const classSections = identified.table('class_sections', {
  id: text('id').primaryKey(),
  schoolId: text('school_id').notNull().references(() => schools.id),
  name: text('name').notNull(),
  gradeLevel: text('grade_level').notNull(),
  /** Default schedule tag for quick entry, e.g. "period_3". */
  periodTag: text('period_tag'),
});

export const users = identified.table(
  'users',
  {
    id: text('id').primaryKey(),
    email: text('email').notNull(),
    displayName: text('display_name').notNull(),
    /** OIDC subject once linked; null for dev users. */
    authSubject: text('auth_subject'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('users_email_idx').on(t.email)],
);

export const roleAssignments = identified.table(
  'role_assignments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id').notNull().references(() => users.id),
    role: text('role').notNull(),
    schoolId: text('school_id').references(() => schools.id),
    sectionId: text('section_id').references(() => classSections.id),
    studentId: text('student_id').references(() => students.id),
  },
  (t) => [index('role_assignments_user_idx').on(t.userId)],
);

export const students = identified.table('students', {
  id: text('id').primaryKey(),
  schoolId: text('school_id').notNull().references(() => schools.id),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  gradeLevel: text('grade_level').notNull(),
  externalId: text('external_id'),
  /**
   * Demographic attributes live ONLY here (docs/02 equity guardrails, docs/04). Nothing in the
   * working plane, the pattern engine or prompt construction can reach this column.
   */
  demographics: jsonb('demographics').$type<Record<string, string>>().notNull().default(sql`'{}'::jsonb`),
  /** Synthetic flag: demonstration posture requires every student to be synthetic. */
  synthetic: boolean('synthetic').notNull().default(true),
});

export const sectionEnrollments = identified.table(
  'section_enrollments',
  {
    sectionId: text('section_id').notNull().references(() => classSections.id),
    studentId: text('student_id').notNull().references(() => students.id),
  },
  (t) => [primaryKey({ columns: [t.sectionId, t.studentId] })],
);

/** THE link table. Every read of it is a plane join and writes an audit event. */
export const caseLinks = identified.table(
  'case_links',
  {
    caseKey: text('case_key').primaryKey(),
    studentId: text('student_id').notNull().references(() => students.id),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('case_links_student_idx').on(t.studentId)],
);

export const authorizationRecords = identified.table('authorization_records', {
  id: text('id').primaryKey(),
  adminUserId: text('admin_user_id').notNull().references(() => users.id),
  studentId: text('student_id').notNull().references(() => students.id),
  grantedByUserId: text('granted_by_user_id').notNull().references(() => users.id),
  reason: text('reason').notNull(),
  grantedAt: ts('granted_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
  revokedAt: ts('revoked_at'),
});

/** Administrator-issued invitations; Clerk delivers the email, we own the role and scope. */
export const invitations = identified.table(
  'invitations',
  {
    id: text('id').primaryKey(),
    orgId: text('org_id').notNull().references(() => organizations.id),
    email: text('email').notNull(),
    role: text('role').notNull(),
    schoolId: text('school_id').references(() => schools.id),
    sectionId: text('section_id').references(() => classSections.id),
    studentId: text('student_id').references(() => students.id),
    clerkInvitationId: text('clerk_invitation_id'),
    /** pending | accepted | revoked */
    status: text('status').notNull().default('pending'),
    invitedBy: text('invited_by').notNull().references(() => users.id),
    userId: text('user_id').references(() => users.id),
    createdAt: ts('created_at').notNull().defaultNow(),
    acceptedAt: ts('accepted_at'),
  },
  (t) => [index('invitations_email_idx').on(t.email)],
);

/**
 * Workspace subscription. The ONLY simulated integration in the product: checkout is a stand-in
 * for Stripe until Stripe is wired, so every row carries `processor: 'simulated'`.
 */
export const subscriptions = identified.table('subscriptions', {
  id: text('id').primaryKey(),
  orgId: text('org_id').notNull().references(() => organizations.id),
  plan: text('plan').notNull(),
  seats: integer('seats').notNull(),
  processor: text('processor').notNull().default('simulated'),
  processorRef: text('processor_ref'),
  /** trialing | active | past_due | canceled */
  status: text('status').notNull().default('active'),
  currentPeriodEnd: ts('current_period_end').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Simulated checkout sessions created by the public sign-up flow, before a workspace exists. */
export const checkoutSessions = identified.table('checkout_sessions', {
  id: text('id').primaryKey(),
  plan: text('plan').notNull(),
  seats: integer('seats').notNull(),
  amountCents: integer('amount_cents').notNull(),
  /** open | paid | expired */
  status: text('status').notNull().default('open'),
  paidAt: ts('paid_at'),
  claimedByUserId: text('claimed_by_user_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

// ---- WORKING PLANE --------------------------------------------------------------------------

export const cases = working.table(
  'cases',
  {
    caseKey: text('case_key').primaryKey(),
    learnerKey: text('learner_key').references(() => learners.learnerKey),
    gradeLevel: text('grade_level').notNull(),
    status: text('status').notNull().default('open'),
    /** Section/school ids are structural, not identifying: they let row scope work without a plane join. */
    sectionId: text('section_id').notNull(),
    schoolId: text('school_id').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('cases_section_idx').on(t.sectionId), index('cases_school_idx').on(t.schoolId)],
);

// Pulsera is additive: existing support records retain their IDs, sources, and approvals.
export const learners = working.table('learners', {
  learnerKey: text('learner_key').primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
});
export const learnerLinks = identified.table('learner_links', {
  studentId: text('student_id').primaryKey().references(() => students.id),
  learnerKey: text('learner_key').notNull().unique().references(() => learners.learnerKey),
  createdAt: ts('created_at').notNull().defaultNow(),
});
export type SeatSnapshot = { learnerKey: string; row: number; column: number };
export const seatingLayouts = working.table('seating_layouts', {
  id: text('id').primaryKey(), sectionId: text('section_id').notNull(),
  version: integer('version').notNull(), positions: jsonb('positions').$type<SeatSnapshot[]>().notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('seating_section_version_idx').on(t.sectionId, t.version)]);
export const classSessions = working.table('class_sessions', {
  id: text('id').primaryKey(), requestId: text('request_id').notNull(), inputHash: text('input_hash').notNull(),
  sectionId: text('section_id').notNull(), schoolId: text('school_id').notNull(), teacherId: text('teacher_id').notNull(),
  date: text('date').notNull(), timezone: text('timezone').notNull(),
  topic: text('topic').notNull(), objective: text('objective').notNull(), contextTags: jsonb('context_tags').$type<string[]>().notNull(),
  seatingVersion: integer('seating_version').notNull(), seatingSnapshot: jsonb('seating_snapshot').$type<SeatSnapshot[]>().notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('session_request_idx').on(t.teacherId, t.requestId), index('session_section_date_idx').on(t.sectionId, t.date)]);
export const classroomEvents = working.table('classroom_events', {
  id: text('id').primaryKey(), sessionId: text('session_id').notNull().references(() => classSessions.id),
  sectionId: text('section_id').notNull(), schoolId: text('school_id').notNull(),
  revision: integer('revision').notNull(), status: text('status').$type<'pending' | 'confirmed' | 'withdrawn'>().notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [index('classroom_events_session_idx').on(t.sessionId)]);
export const eventRevisions = working.table('event_revisions', {
  id: text('id').primaryKey(), eventId: text('event_id').notNull().references(() => classroomEvents.id),
  revision: integer('revision').notNull(), learnerKey: text('learner_key').notNull().references(() => learners.learnerKey),
  requestId: text('request_id').notNull(), inputHash: text('input_hash').notNull(),
  observation: jsonb('observation').$type<ClassroomObservation>().notNull(), source: text('source').notNull(),
  observedAt: ts('observed_at').notNull(), createdBy: text('created_by').notNull(),
  confirmedBy: text('confirmed_by'), confirmedAt: ts('confirmed_at'), reason: text('reason'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('event_revision_idx').on(t.eventId, t.revision), uniqueIndex('event_request_idx').on(t.createdBy, t.requestId)]);

export const classroomDrafts = working.table('classroom_drafts', {
  id: text('id').primaryKey(), sessionId: text('session_id').notNull().references(() => classSessions.id),
  sectionId: text('section_id').notNull(), schoolId: text('school_id').notNull(), createdBy: text('created_by').notNull(),
  kind: text('kind').$type<ArtifactKind>().notNull(), sources: jsonb('sources').$type<ArtifactSource[]>().notNull(),
  generationKey: text('generation_key').notNull().unique(), revision: integer('revision').notNull().default(0),
  generationState: text('generation_state').$type<'queued' | 'running' | 'ready' | 'failed' | 'disabled'>().notNull(),
  reviewState: text('review_state').$type<'suggested' | 'approved' | 'discarded' | 'stale'>().notNull().default('suggested'),
  publicationState: text('publication_state').$type<'unpublished' | 'logged' | 'needs_review'>().notNull().default('unpublished'),
  promptVersionId: text('prompt_version_id'), runId: text('run_id'), error: text('error'),
  runIds: jsonb('run_ids').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
  deferredUntil: ts('deferred_until'), expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('classroom_drafts_owner_idx').on(t.createdBy, t.sectionId)]);
export const artifactRevisions = working.table('artifact_revisions', {
  id: text('id').primaryKey(), draftId: text('draft_id').notNull().references(() => classroomDrafts.id),
  revision: integer('revision').notNull(), content: jsonb('content').$type<ArtifactContent>().notNull(),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('artifact_revision_idx').on(t.draftId, t.revision)]);
export const artifactPublications = working.table('artifact_publications', {
  id: text('id').primaryKey(), draftId: text('draft_id').notNull().references(() => classroomDrafts.id), revision: integer('revision').notNull(),
  audience: text('audience').$type<'teacher' | 'student' | 'family'>().notNull(),
  approvedBy: text('approved_by').notNull(), approvedAt: ts('approved_at').notNull(),
  // Export is not delivery and does not grant portal access.
  deliveryState: text('delivery_state').notNull().default('not_sent'),
}, (t) => [uniqueIndex('artifact_publication_idx').on(t.draftId, t.revision)]);

export const tomorrowSchedules = working.table('tomorrow_schedules', {
  sectionId: text('section_id').notNull(), teacherId: text('teacher_id').notNull(),
  settings: jsonb('settings').$type<TomorrowSchedule>().notNull(), lastPreparedDate: text('last_prepared_date'),
  lastResult: text('last_result'), targetDate: text('target_date'), updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.sectionId, t.teacherId] })]);

export const followUpTasks = working.table('follow_up_tasks', {
  id: text('id').primaryKey(), requestId: text('request_id').notNull(), inputHash: text('input_hash').notNull(),
  draftId: text('draft_id').notNull().references(() => classroomDrafts.id), artifactRevision: integer('artifact_revision').notNull(),
  sectionId: text('section_id').notNull(), schoolId: text('school_id').notNull(),
  createdBy: text('created_by').notNull(), ownerId: text('owner_id').notNull(),
  kind: text('kind').$type<'follow_up' | 'intervention_review'>().notNull(),
  title: text('title').notNull(), action: text('action').notNull(), dueDate: text('due_date').notNull(),
  status: text('status').$type<'open' | 'completed' | 'cancelled' | 'needs_review'>().notNull().default('open'),
  revision: integer('revision').notNull().default(1), approvedAt: ts('approved_at').notNull(),
  completedAt: ts('completed_at'), createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('follow_up_request_idx').on(t.createdBy, t.requestId), index('follow_up_owner_idx').on(t.ownerId, t.dueDate)]);

export const artifactShares = working.table('artifact_shares', {
  publicationId: text('publication_id').primaryKey().references(() => artifactPublications.id),
  sharedBy: text('shared_by').notNull(), sharedAt: ts('shared_at').notNull(), revokedAt: ts('revoked_at'),
});
export const contributions = working.table('contributions', {
  id: text('id').primaryKey(), learnerKey: text('learner_key').notNull().references(() => learners.learnerKey),
  sectionId: text('section_id').notNull(), schoolId: text('school_id').notNull(),
  createdBy: text('created_by').notNull(), sourceRole: text('source_role').$type<'student' | 'guardian'>().notNull(), recipientId: text('recipient_id').notNull(),
  revision: integer('revision').notNull().default(1), status: text('status').$type<'pending' | 'acknowledged' | 'accepted' | 'declined' | 'withdrawn' | 'expired'>().notNull().default('pending'),
  response: text('response'), respondedAt: ts('responded_at'), expiresAt: ts('expires_at').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(), updatedAt: ts('updated_at').notNull().defaultNow(),
}, (t) => [index('contributions_recipient_idx').on(t.recipientId, t.sectionId)]);
export const contributionRevisions = working.table('contribution_revisions', {
  id: text('id').primaryKey(), contributionId: text('contribution_id').notNull().references(() => contributions.id), revision: integer('revision').notNull(),
  content: jsonb('content').$type<ContributionContent>().notNull(), createdBy: text('created_by').notNull(), requestId: text('request_id').notNull(), inputHash: text('input_hash').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('contribution_revision_idx').on(t.contributionId, t.revision), uniqueIndex('contribution_request_idx').on(t.createdBy, t.requestId)]);
export const contributionResponses = working.table('contribution_responses', {
  id: text('id').primaryKey(), contributionId: text('contribution_id').notNull().references(() => contributions.id), revision: integer('revision').notNull(),
  decision: text('decision').notNull(), response: text('response').notNull(), createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(),
});
export const classroomHelpRequests = working.table('classroom_help_requests', {
  id: text('id').primaryKey(), requestId: text('request_id').notNull(), inputHash: text('input_hash').notNull(), learnerKey: text('learner_key').notNull().references(() => learners.learnerKey),
  sectionId: text('section_id').notNull(), schoolId: text('school_id').notNull(), createdBy: text('created_by').notNull(), recipientId: text('recipient_id').notNull(),
  description: text('description').notNull(), status: text('status').$type<'open' | 'acknowledged'>().notNull().default('open'), acknowledgedAt: ts('acknowledged_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('classroom_help_request_idx').on(t.createdBy, t.requestId)]);

export const intakes = working.table('intakes', {
  id: text('id').primaryKey(),
  caseKey: text('case_key').notNull().references(() => cases.caseKey),
  version: integer('version').notNull(),
  fields: jsonb('fields').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const promptVersions = working.table('prompt_versions', {
  id: text('id').primaryKey(),
  surface: text('surface').notNull(),
  version: integer('version').notNull(),
  body: text('body').notNull(),
  model: text('model').notNull(),
  params: jsonb('params').notNull(),
  changelog: text('changelog').notNull(),
  createdBy: text('created_by').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
  status: text('status').notNull(),
});

export const generationRuns = working.table(
  'generation_runs',
  {
    id: text('id').primaryKey(),
    surface: text('surface').notNull(),
    caseKey: text('case_key'),
    promptVersionId: text('prompt_version_id').notNull(),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    inputHash: text('input_hash').notNull(),
    latencyMs: integer('latency_ms'),
    tokens: jsonb('tokens'),
    status: text('status').notNull(),
    attempt: integer('attempt').notNull().default(1),
    error: text('error'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('generation_runs_case_idx').on(t.caseKey)],
);

/** Egress log (docs/04): exactly what left, so you can prove it rather than assert it. */
export const egressLog = working.table('egress_log', {
  id: text('id').primaryKey(),
  runId: text('run_id').notNull(),
  surface: text('surface').notNull(),
  caseKey: text('case_key'),
  promptVersionId: text('prompt_version_id').notNull(),
  model: text('model').notNull(),
  provider: text('provider').notNull(),
  instructions: text('instructions').notNull(),
  input: text('input').notNull(),
  inputHash: text('input_hash').notNull(),
  status: text('status').notNull(),
  latencyMs: integer('latency_ms'),
  usage: jsonb('usage'),
  posture: jsonb('posture').notNull(),
  piiWarnings: jsonb('pii_warnings').notNull(),
  error: text('error'),
  at: ts('at').notNull().defaultNow(),
});

/** Expirable classroom text is separate from the immutable egress metadata/hash trail. */
export const classroomEgressPayloads = working.table('classroom_egress_payloads', {
  runId: text('run_id').primaryKey(), input: text('input').notNull(),
  expiresAt: ts('expires_at').notNull(), createdAt: ts('created_at').notNull().defaultNow(),
});

export const planDrafts = working.table(
  'plan_drafts',
  {
    id: text('id').primaryKey(),
    caseKey: text('case_key').notNull().references(() => cases.caseKey),
    intakeId: text('intake_id').notNull().references(() => intakes.id),
    runId: text('run_id'),
    content: jsonb('content'),
    guardrails: jsonb('guardrails'),
    /** queued | running | ready | needs_attention | blocked_pii | failed | approved | discarded */
    status: text('status').notNull().default('queued'),
    error: text('error'),
    piiSpans: jsonb('pii_spans'),
    createdBy: text('created_by').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('plan_drafts_case_idx').on(t.caseKey)],
);

export const classroomPlanOrigins = working.table('classroom_plan_origins', {
  draftId: text('draft_id').primaryKey().references(() => planDrafts.id), basePlanId: text('base_plan_id').notNull(),
  sectionId: text('section_id').notNull(), createdBy: text('created_by').notNull(), requestId: text('request_id').notNull(), inputHash: text('input_hash').notNull(),
  sources: jsonb('sources').$type<PlanRevisionSource[]>().notNull(), invalidatedAt: ts('invalidated_at'),
  baseSnapshot: jsonb('base_snapshot'),
  createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('classroom_plan_request_idx').on(t.createdBy, t.requestId)]);

export const plans = working.table(
  'plans',
  {
    id: text('id').primaryKey(),
    caseKey: text('case_key').notNull().references(() => cases.caseKey),
    draftId: text('draft_id').notNull().references(() => planDrafts.id),
    sourceReviewNeeded: boolean('source_review_needed').notNull().default(false),
    content: jsonb('content').notNull(),
    status: text('status').notNull(),
    version: integer('version').notNull().default(1),
    promptVersionId: text('prompt_version_id'),
    createdBy: text('created_by').notNull(),
    approvedBy: text('approved_by'),
    approvedAt: ts('approved_at'),
    draftDiff: jsonb('draft_diff'),
    transitions: jsonb('transitions').notNull().default(sql`'[]'::jsonb`),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('plans_case_idx').on(t.caseKey)],
);

export const goals = working.table(
  'goals',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id').notNull().references(() => plans.id),
    caseKey: text('case_key').notNull(),
    content: jsonb('content').notNull(),
    status: text('status').notNull().default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('goals_plan_idx').on(t.planId)],
);

export const strategies = working.table(
  'strategies',
  {
    id: text('id').primaryKey(),
    planId: text('plan_id').notNull().references(() => plans.id),
    caseKey: text('case_key').notNull(),
    kind: text('kind').notNull(),
    content: jsonb('content').notNull(),
    status: text('status').notNull().default('active'),
    sortOrder: integer('sort_order').notNull().default(0),
  },
  (t) => [index('strategies_plan_idx').on(t.planId)],
);

export const reviewCycles = working.table(
  'review_cycles',
  {
    id: text('id').primaryKey(),
    sourceInvalidatedAt: ts('source_invalidated_at'),
    evidenceVersion: integer('evidence_version').notNull().default(1),
    planId: text('plan_id').notNull().references(() => plans.id),
    caseKey: text('case_key').notNull(),
    dueAt: ts('due_at').notNull(),
    status: text('status').notNull().default('scheduled'),
    computed: jsonb('computed'),
    narrative: jsonb('narrative'),
    narrativeRunId: text('narrative_run_id'),
    narrativeStatus: text('narrative_status'),
    decision: text('decision'),
    rationale: text('rationale'),
    reviewerUserId: text('reviewer_user_id'),
    decidedAt: ts('decided_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('review_cycles_plan_idx').on(t.planId)],
);

export const signals = working.table(
  'signals',
  {
    id: text('id').primaryKey(),
    retiredAt: ts('retired_at'),
    caseKey: text('case_key').notNull().references(() => cases.caseKey),
    type: text('type').notNull(),
    valueNum: real('value_num'),
    valueText: text('value_text'),
    unit: text('unit'),
    contextTags: jsonb('context_tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    observedAt: ts('observed_at').notNull(),
    source: text('source').notNull(),
    sourceConfidence: text('source_confidence').notNull(),
    enteredBy: text('entered_by'),
    goalId: text('goal_id'),
    strategyId: text('strategy_id'),
    note: text('note'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('signals_case_time_idx').on(t.caseKey, t.observedAt)],
);

export const signalProjections = working.table('signal_projections', {
  eventId: text('event_id').notNull().references(() => classroomEvents.id), revision: integer('revision').notNull(),
  caseKey: text('case_key').notNull().references(() => cases.caseKey), signalId: text('signal_id').notNull().references(() => signals.id),
  createdBy: text('created_by').notNull(), createdAt: ts('created_at').notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.eventId, t.revision, t.caseKey] })]);

/** Admin overrides of the code-defined catalog status (piloting → active → retired). */
export const definitionStatus = working.table('definition_status', {
  definitionId: text('definition_id').primaryKey(),
  version: integer('version').notNull(),
  status: text('status').notNull(),
  reviewer: text('reviewer'),
  updatedBy: text('updated_by').notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const patternCandidates = working.table(
  'pattern_candidates',
  {
    id: text('id').primaryKey(),
    sourceInvalidatedAt: ts('source_invalidated_at'),
    caseKey: text('case_key').notNull().references(() => cases.caseKey),
    definitionId: text('definition_id').notNull(),
    definitionVersion: integer('definition_version').notNull(),
    title: text('title').notNull(),
    plainLanguage: text('plain_language').notNull(),
    confounders: jsonb('confounders').$type<string[]>().notNull(),
    status: text('status').notNull().default('detected'),
    strength: real('strength').notNull(),
    evidenceRefs: jsonb('evidence_refs').$type<string[]>().notNull(),
    measures: jsonb('measures').$type<Record<string, number>>().notNull(),
    routing: text('routing').notNull(),
    proposal: jsonb('proposal'),
    proposalRunId: text('proposal_run_id'),
    /** none | pending | ready | needs_attention | failed */
    proposalStatus: text('proposal_status').notNull().default('none'),
    proposalGuardrails: jsonb('proposal_guardrails'),
    detectedAt: ts('detected_at').notNull().defaultNow(),
    adjudicatedBy: text('adjudicated_by'),
    adjudicatedAt: ts('adjudicated_at'),
    dismissalReason: text('dismissal_reason'),
    adjudicationNote: text('adjudication_note'),
    collectionTarget: jsonb('collection_target'),
    visible: boolean('visible').notNull().default(false),
    /** Set when a confirmed candidate seeded a goal/strategy. */
    resultingGoalId: text('resulting_goal_id'),
    resultingStrategyId: text('resulting_strategy_id'),
  },
  (t) => [index('pattern_candidates_case_idx').on(t.caseKey), index('pattern_candidates_status_idx').on(t.status)],
);

export const insufficientDataNotes = working.table(
  'insufficient_data_notes',
  {
    id: text('id').primaryKey(),
    caseKey: text('case_key').notNull().references(() => cases.caseKey),
    definitionId: text('definition_id').notNull(),
    definitionVersion: integer('definition_version').notNull(),
    title: text('title').notNull(),
    missing: jsonb('missing').$type<string[]>().notNull(),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('insufficient_case_idx').on(t.caseKey)],
);

export const safetyFlags = working.table('safety_flags', {
  id: text('id').primaryKey(),
  caseKey: text('case_key').notNull().references(() => cases.caseKey),
  source: text('source').notNull(),
  description: text('description').notNull(),
  status: text('status').notNull().default('open'),
  createdAt: ts('created_at').notNull().defaultNow(),
  acknowledgedBy: text('acknowledged_by'),
});

export const correctionRequests = working.table('correction_requests', {
  id: text('id').primaryKey(),
  caseKey: text('case_key').notNull().references(() => cases.caseKey),
  requestedByUserId: text('requested_by_user_id').notNull(),
  subject: text('subject').notNull(),
  detail: text('detail').notNull(),
  status: text('status').notNull().default('open'),
  resolutionNote: text('resolution_note'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const evalRuns = working.table('eval_runs', {
  id: text('id').primaryKey(),
  promptVersionId: text('prompt_version_id').notNull(),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  passed: boolean('passed').notNull(),
  passedCases: integer('passed_cases').notNull(),
  totalCases: integer('total_cases').notNull(),
  report: jsonb('report').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** Append-only: a trigger in the migration rejects UPDATE and DELETE. */
export const auditEvents = working.table(
  'audit_events',
  {
    id: text('id').primaryKey(),
    actorUserId: text('actor_user_id'),
    actorRole: text('actor_role'),
    action: text('action').notNull(),
    targetType: text('target_type').notNull(),
    targetId: text('target_id'),
    caseKey: text('case_key'),
    studentId: text('student_id'),
    metadata: jsonb('metadata').notNull().default(sql`'{}'::jsonb`),
    at: ts('at').notNull().defaultNow(),
  },
  (t) => [index('audit_events_at_idx').on(t.at), index('audit_events_student_idx').on(t.studentId)],
);

/** Content-free retry tombstones prevent expired submissions being silently recreated. */
export const expiredClassroomRequests = working.table('expired_classroom_requests', {
  id: text('id').primaryKey(),
  kind: text('kind').$type<'event' | 'contribution'>().notNull(),
  createdBy: text('created_by').notNull(),
  requestId: text('request_id').notNull(),
}, (t) => [uniqueIndex('expired_classroom_requests_unique').on(t.kind, t.createdBy, t.requestId)]);

/** Durable job queue for the in-process driver, so a restart does not lose generation work. */
export const jobs = working.table(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: jsonb('payload').notNull(),
    /** queued | running | done | failed */
    status: text('status').notNull().default('queued'),
    attempts: integer('attempts').notNull().default(0),
    leaseToken: text('lease_token'),
    error: text('error'),
    runAt: ts('run_at').notNull().defaultNow(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('jobs_status_idx').on(t.status, t.runAt)],
);
