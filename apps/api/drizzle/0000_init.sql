-- Squashed baseline (2026-10-02): the schema from src/db/schema.ts as drizzle-kit generates it,
-- plus the hand-written triggers below that drizzle-kit cannot express. Earlier migrations
-- (0000-0022) and their data backfills were retired with every database reseeded; see docs/08.
CREATE SCHEMA "identified";
--> statement-breakpoint
CREATE SCHEMA "working";
--> statement-breakpoint
CREATE TABLE "working"."artifact_publications" (
	"id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"revision" integer NOT NULL,
	"audience" text NOT NULL,
	"approved_by" text NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"delivery_state" text DEFAULT 'not_sent' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."artifact_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"draft_id" text NOT NULL,
	"revision" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."artifact_shares" (
	"publication_id" text PRIMARY KEY NOT NULL,
	"shared_by" text NOT NULL,
	"shared_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "working"."audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"actor_user_id" text,
	"actor_role" text,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"case_key" text,
	"student_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."authorization_records" (
	"id" text PRIMARY KEY NOT NULL,
	"admin_user_id" text NOT NULL,
	"student_id" text NOT NULL,
	"granted_by_user_id" text NOT NULL,
	"reason" text NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "identified"."case_links" (
	"case_key" text PRIMARY KEY NOT NULL,
	"student_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."cases" (
	"case_key" text PRIMARY KEY NOT NULL,
	"learner_key" text,
	"grade_level" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"section_id" text NOT NULL,
	"school_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."checkout_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"plan" text NOT NULL,
	"seats" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"paid_at" timestamp with time zone,
	"claimed_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."class_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"name" text NOT NULL,
	"grade_level" text NOT NULL,
	"period_tag" text,
	"course_name" text,
	"room" text,
	"accent" text,
	"archived_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."class_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"section_id" text NOT NULL,
	"school_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"date" text NOT NULL,
	"timezone" text NOT NULL,
	"topic" text NOT NULL,
	"objective" text NOT NULL,
	"context_tags" jsonb NOT NULL,
	"seating_version" integer NOT NULL,
	"seating_snapshot" jsonb NOT NULL,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."classroom_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"section_id" text NOT NULL,
	"school_id" text NOT NULL,
	"created_by" text NOT NULL,
	"kind" text NOT NULL,
	"sources" jsonb NOT NULL,
	"generation_key" text NOT NULL,
	"revision" integer DEFAULT 0 NOT NULL,
	"generation_state" text NOT NULL,
	"review_state" text DEFAULT 'suggested' NOT NULL,
	"publication_state" text DEFAULT 'unpublished' NOT NULL,
	"prompt_version_id" text,
	"run_id" text,
	"error" text,
	"run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deferred_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_drafts_generation_key_unique" UNIQUE("generation_key")
);
--> statement-breakpoint
CREATE TABLE "working"."classroom_egress_payloads" (
	"run_id" text PRIMARY KEY NOT NULL,
	"input" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."classroom_events" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"section_id" text NOT NULL,
	"school_id" text NOT NULL,
	"revision" integer NOT NULL,
	"status" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."classroom_help_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"learner_key" text NOT NULL,
	"section_id" text NOT NULL,
	"school_id" text NOT NULL,
	"created_by" text NOT NULL,
	"recipient_id" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."classroom_plan_origins" (
	"draft_id" text PRIMARY KEY NOT NULL,
	"base_plan_id" text NOT NULL,
	"section_id" text NOT NULL,
	"created_by" text NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"sources" jsonb NOT NULL,
	"invalidated_at" timestamp with time zone,
	"base_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."contribution_responses" (
	"id" text PRIMARY KEY NOT NULL,
	"contribution_id" text NOT NULL,
	"revision" integer NOT NULL,
	"decision" text NOT NULL,
	"response" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."contribution_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"contribution_id" text NOT NULL,
	"revision" integer NOT NULL,
	"content" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."contributions" (
	"id" text PRIMARY KEY NOT NULL,
	"learner_key" text NOT NULL,
	"section_id" text NOT NULL,
	"school_id" text NOT NULL,
	"created_by" text NOT NULL,
	"source_role" text NOT NULL,
	"recipient_id" text NOT NULL,
	"visibility" text DEFAULT 'teacher' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response" text,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."correction_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"case_key" text NOT NULL,
	"requested_by_user_id" text NOT NULL,
	"subject" text NOT NULL,
	"detail" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."definition_status" (
	"definition_id" text PRIMARY KEY NOT NULL,
	"version" integer NOT NULL,
	"status" text NOT NULL,
	"reviewer" text,
	"updated_by" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."egress_log" (
	"id" text PRIMARY KEY NOT NULL,
	"run_id" text NOT NULL,
	"surface" text NOT NULL,
	"case_key" text,
	"prompt_version_id" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"instructions" text NOT NULL,
	"input" text NOT NULL,
	"input_hash" text NOT NULL,
	"status" text NOT NULL,
	"latency_ms" integer,
	"usage" jsonb,
	"posture" jsonb NOT NULL,
	"pii_warnings" jsonb NOT NULL,
	"error" text,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."eval_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"prompt_version_id" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"passed" boolean NOT NULL,
	"passed_cases" integer NOT NULL,
	"total_cases" integer NOT NULL,
	"report" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."event_revisions" (
	"id" text PRIMARY KEY NOT NULL,
	"event_id" text NOT NULL,
	"revision" integer NOT NULL,
	"learner_key" text NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"observation" jsonb NOT NULL,
	"source" text NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"created_by" text NOT NULL,
	"confirmed_by" text,
	"confirmed_at" timestamp with time zone,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."expired_classroom_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"created_by" text NOT NULL,
	"request_id" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."follow_up_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"draft_id" text NOT NULL,
	"artifact_revision" integer NOT NULL,
	"section_id" text NOT NULL,
	"school_id" text NOT NULL,
	"created_by" text NOT NULL,
	"owner_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"action" text NOT NULL,
	"due_date" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"approved_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."generation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"surface" text NOT NULL,
	"case_key" text,
	"prompt_version_id" text NOT NULL,
	"model" text NOT NULL,
	"provider" text NOT NULL,
	"input_hash" text NOT NULL,
	"latency_ms" integer,
	"tokens" jsonb,
	"status" text NOT NULL,
	"attempt" integer DEFAULT 1 NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."goals" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"case_key" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."insufficient_data_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"case_key" text NOT NULL,
	"definition_id" text NOT NULL,
	"definition_version" integer NOT NULL,
	"title" text NOT NULL,
	"missing" jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."intakes" (
	"id" text PRIMARY KEY NOT NULL,
	"case_key" text NOT NULL,
	"version" integer NOT NULL,
	"fields" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."invitations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"school_id" text,
	"section_id" text,
	"student_id" text,
	"clerk_invitation_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"invited_by" text NOT NULL,
	"user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "working"."jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_token" text,
	"error" text,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."learner_links" (
	"student_id" text PRIMARY KEY NOT NULL,
	"learner_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learner_links_learner_key_unique" UNIQUE("learner_key")
);
--> statement-breakpoint
CREATE TABLE "working"."learners" (
	"learner_key" text PRIMARY KEY NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"pulsera_enabled" boolean DEFAULT true NOT NULL,
	"context_tag_extensions" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."pattern_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"source_invalidated_at" timestamp with time zone,
	"case_key" text NOT NULL,
	"definition_id" text NOT NULL,
	"definition_version" integer NOT NULL,
	"title" text NOT NULL,
	"plain_language" text NOT NULL,
	"confounders" jsonb NOT NULL,
	"status" text DEFAULT 'detected' NOT NULL,
	"strength" real NOT NULL,
	"evidence_refs" jsonb NOT NULL,
	"measures" jsonb NOT NULL,
	"routing" text NOT NULL,
	"proposal" jsonb,
	"proposal_run_id" text,
	"proposal_status" text DEFAULT 'none' NOT NULL,
	"proposal_guardrails" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"adjudicated_by" text,
	"adjudicated_at" timestamp with time zone,
	"dismissal_reason" text,
	"adjudication_note" text,
	"collection_target" jsonb,
	"visible" boolean DEFAULT false NOT NULL,
	"resulting_goal_id" text,
	"resulting_strategy_id" text
);
--> statement-breakpoint
CREATE TABLE "working"."plan_drafts" (
	"id" text PRIMARY KEY NOT NULL,
	"case_key" text NOT NULL,
	"intake_id" text NOT NULL,
	"run_id" text,
	"content" jsonb,
	"guardrails" jsonb,
	"status" text DEFAULT 'queued' NOT NULL,
	"error" text,
	"pii_spans" jsonb,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."plans" (
	"id" text PRIMARY KEY NOT NULL,
	"case_key" text NOT NULL,
	"draft_id" text NOT NULL,
	"source_review_needed" boolean DEFAULT false NOT NULL,
	"content" jsonb NOT NULL,
	"status" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"prompt_version_id" text,
	"created_by" text NOT NULL,
	"approved_by" text,
	"approved_at" timestamp with time zone,
	"draft_diff" jsonb,
	"transitions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."prompt_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"surface" text NOT NULL,
	"version" integer NOT NULL,
	"body" text NOT NULL,
	"model" text NOT NULL,
	"params" jsonb NOT NULL,
	"changelog" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"status" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."report_template_validations" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"kind" text NOT NULL,
	"validated_by" text NOT NULL,
	"validator_role" text NOT NULL,
	"notes" text NOT NULL,
	"validated_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "working"."review_cycles" (
	"id" text PRIMARY KEY NOT NULL,
	"source_invalidated_at" timestamp with time zone,
	"evidence_version" integer DEFAULT 1 NOT NULL,
	"plan_id" text NOT NULL,
	"case_key" text NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"computed" jsonb,
	"narrative" jsonb,
	"narrative_run_id" text,
	"narrative_status" text,
	"decision" text,
	"rationale" text,
	"reviewer_user_id" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."role_assignments" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"school_id" text,
	"section_id" text,
	"student_id" text
);
--> statement-breakpoint
CREATE TABLE "working"."safety_flags" (
	"id" text PRIMARY KEY NOT NULL,
	"case_key" text NOT NULL,
	"source" text NOT NULL,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acknowledged_by" text
);
--> statement-breakpoint
CREATE TABLE "identified"."schools" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"family_wellbeing_collection" boolean DEFAULT true NOT NULL,
	"pending_retention_days" integer DEFAULT 30 NOT NULL,
	"memory_window_days" integer DEFAULT 120 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."seating_layouts" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"version" integer NOT NULL,
	"positions" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."section_enrollments" (
	"section_id" text NOT NULL,
	"student_id" text NOT NULL,
	CONSTRAINT "section_enrollments_section_id_student_id_pk" PRIMARY KEY("section_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "working"."signal_projections" (
	"event_id" text NOT NULL,
	"revision" integer NOT NULL,
	"case_key" text NOT NULL,
	"signal_id" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signal_projections_event_id_revision_case_key_pk" PRIMARY KEY("event_id","revision","case_key")
);
--> statement-breakpoint
CREATE TABLE "working"."signals" (
	"id" text PRIMARY KEY NOT NULL,
	"retired_at" timestamp with time zone,
	"case_key" text NOT NULL,
	"type" text NOT NULL,
	"value_num" real,
	"value_text" text,
	"unit" text,
	"context_tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"observed_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"source_confidence" text NOT NULL,
	"entered_by" text,
	"goal_id" text,
	"strategy_id" text,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."strategies" (
	"id" text PRIMARY KEY NOT NULL,
	"plan_id" text NOT NULL,
	"case_key" text NOT NULL,
	"kind" text NOT NULL,
	"content" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."students" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"grade_level" text NOT NULL,
	"external_id" text,
	"demographics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"synthetic" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"plan" text NOT NULL,
	"seats" integer NOT NULL,
	"processor" text DEFAULT 'simulated' NOT NULL,
	"processor_ref" text,
	"status" text DEFAULT 'active' NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."teacher_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"capture_vocabulary" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."tomorrow_schedules" (
	"section_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"settings" jsonb NOT NULL,
	"last_prepared_date" text,
	"last_result" text,
	"target_date" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tomorrow_schedules_section_id_teacher_id_pk" PRIMARY KEY("section_id","teacher_id")
);
--> statement-breakpoint
CREATE TABLE "identified"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"auth_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."voice_approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"provider" text NOT NULL,
	"approved_by_name" text NOT NULL,
	"approved_by_title" text NOT NULL,
	"policy_reference" text NOT NULL,
	"recorded_by" text NOT NULL,
	"recorded_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "working"."artifact_publications" ADD CONSTRAINT "artifact_publications_draft_id_classroom_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "working"."classroom_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."artifact_revisions" ADD CONSTRAINT "artifact_revisions_draft_id_classroom_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "working"."classroom_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."artifact_shares" ADD CONSTRAINT "artifact_shares_publication_id_artifact_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "working"."artifact_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."authorization_records" ADD CONSTRAINT "authorization_records_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "identified"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."authorization_records" ADD CONSTRAINT "authorization_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "identified"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."authorization_records" ADD CONSTRAINT "authorization_records_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "identified"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."case_links" ADD CONSTRAINT "case_links_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "identified"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."cases" ADD CONSTRAINT "cases_learner_key_learners_learner_key_fk" FOREIGN KEY ("learner_key") REFERENCES "working"."learners"("learner_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."class_sections" ADD CONSTRAINT "class_sections_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "identified"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."classroom_drafts" ADD CONSTRAINT "classroom_drafts_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "working"."class_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."classroom_events" ADD CONSTRAINT "classroom_events_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "working"."class_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."classroom_help_requests" ADD CONSTRAINT "classroom_help_requests_learner_key_learners_learner_key_fk" FOREIGN KEY ("learner_key") REFERENCES "working"."learners"("learner_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."classroom_plan_origins" ADD CONSTRAINT "classroom_plan_origins_draft_id_plan_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "working"."plan_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."contribution_responses" ADD CONSTRAINT "contribution_responses_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "working"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."contribution_revisions" ADD CONSTRAINT "contribution_revisions_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "working"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."contributions" ADD CONSTRAINT "contributions_learner_key_learners_learner_key_fk" FOREIGN KEY ("learner_key") REFERENCES "working"."learners"("learner_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."correction_requests" ADD CONSTRAINT "correction_requests_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."event_revisions" ADD CONSTRAINT "event_revisions_event_id_classroom_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "working"."classroom_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."event_revisions" ADD CONSTRAINT "event_revisions_learner_key_learners_learner_key_fk" FOREIGN KEY ("learner_key") REFERENCES "working"."learners"("learner_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_draft_id_classroom_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "working"."classroom_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."goals" ADD CONSTRAINT "goals_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "working"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."insufficient_data_notes" ADD CONSTRAINT "insufficient_data_notes_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."intakes" ADD CONSTRAINT "intakes_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."invitations" ADD CONSTRAINT "invitations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identified"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."invitations" ADD CONSTRAINT "invitations_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "identified"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."invitations" ADD CONSTRAINT "invitations_section_id_class_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "identified"."class_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."invitations" ADD CONSTRAINT "invitations_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "identified"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."invitations" ADD CONSTRAINT "invitations_invited_by_users_id_fk" FOREIGN KEY ("invited_by") REFERENCES "identified"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."invitations" ADD CONSTRAINT "invitations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identified"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."learner_links" ADD CONSTRAINT "learner_links_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "identified"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."learner_links" ADD CONSTRAINT "learner_links_learner_key_learners_learner_key_fk" FOREIGN KEY ("learner_key") REFERENCES "working"."learners"("learner_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."pattern_candidates" ADD CONSTRAINT "pattern_candidates_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."plan_drafts" ADD CONSTRAINT "plan_drafts_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."plan_drafts" ADD CONSTRAINT "plan_drafts_intake_id_intakes_id_fk" FOREIGN KEY ("intake_id") REFERENCES "working"."intakes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."plans" ADD CONSTRAINT "plans_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."plans" ADD CONSTRAINT "plans_draft_id_plan_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "working"."plan_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."review_cycles" ADD CONSTRAINT "review_cycles_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "working"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."role_assignments" ADD CONSTRAINT "role_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identified"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."role_assignments" ADD CONSTRAINT "role_assignments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "identified"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."role_assignments" ADD CONSTRAINT "role_assignments_section_id_class_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "identified"."class_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."role_assignments" ADD CONSTRAINT "role_assignments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "identified"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."safety_flags" ADD CONSTRAINT "safety_flags_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."schools" ADD CONSTRAINT "schools_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identified"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."section_enrollments" ADD CONSTRAINT "section_enrollments_section_id_class_sections_id_fk" FOREIGN KEY ("section_id") REFERENCES "identified"."class_sections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."section_enrollments" ADD CONSTRAINT "section_enrollments_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "identified"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."signal_projections" ADD CONSTRAINT "signal_projections_event_id_classroom_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "working"."classroom_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."signal_projections" ADD CONSTRAINT "signal_projections_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."signal_projections" ADD CONSTRAINT "signal_projections_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "working"."signals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."signals" ADD CONSTRAINT "signals_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."strategies" ADD CONSTRAINT "strategies_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "working"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."students" ADD CONSTRAINT "students_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "identified"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."subscriptions" ADD CONSTRAINT "subscriptions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "identified"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_publication_idx" ON "working"."artifact_publications" USING btree ("draft_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_revision_idx" ON "working"."artifact_revisions" USING btree ("draft_id","revision");--> statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "working"."audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_events_student_idx" ON "working"."audit_events" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "case_links_student_idx" ON "identified"."case_links" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "cases_section_idx" ON "working"."cases" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "cases_school_idx" ON "working"."cases" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "session_request_idx" ON "working"."class_sessions" USING btree ("teacher_id","request_id");--> statement-breakpoint
CREATE INDEX "session_section_date_idx" ON "working"."class_sessions" USING btree ("section_id","date");--> statement-breakpoint
CREATE INDEX "classroom_drafts_owner_idx" ON "working"."classroom_drafts" USING btree ("created_by","section_id");--> statement-breakpoint
CREATE INDEX "classroom_events_session_idx" ON "working"."classroom_events" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_help_request_idx" ON "working"."classroom_help_requests" USING btree ("created_by","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_plan_request_idx" ON "working"."classroom_plan_origins" USING btree ("created_by","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_revision_idx" ON "working"."contribution_revisions" USING btree ("contribution_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_request_idx" ON "working"."contribution_revisions" USING btree ("created_by","request_id");--> statement-breakpoint
CREATE INDEX "contributions_recipient_idx" ON "working"."contributions" USING btree ("recipient_id","section_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_revision_idx" ON "working"."event_revisions" USING btree ("event_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "event_request_idx" ON "working"."event_revisions" USING btree ("created_by","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "expired_classroom_requests_unique" ON "working"."expired_classroom_requests" USING btree ("kind","created_by","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_request_idx" ON "working"."follow_up_tasks" USING btree ("created_by","request_id");--> statement-breakpoint
CREATE INDEX "follow_up_owner_idx" ON "working"."follow_up_tasks" USING btree ("owner_id","due_date");--> statement-breakpoint
CREATE INDEX "generation_runs_case_idx" ON "working"."generation_runs" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "goals_plan_idx" ON "working"."goals" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "insufficient_case_idx" ON "working"."insufficient_data_notes" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "invitations_email_idx" ON "identified"."invitations" USING btree ("email");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "working"."jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "pattern_candidates_case_idx" ON "working"."pattern_candidates" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "pattern_candidates_status_idx" ON "working"."pattern_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "plan_drafts_case_idx" ON "working"."plan_drafts" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "plans_case_idx" ON "working"."plans" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "report_template_validation_idx" ON "working"."report_template_validations" USING btree ("school_id","kind");--> statement-breakpoint
CREATE INDEX "review_cycles_plan_idx" ON "working"."review_cycles" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "role_assignments_user_idx" ON "identified"."role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seating_section_version_idx" ON "working"."seating_layouts" USING btree ("section_id","version");--> statement-breakpoint
CREATE INDEX "signals_case_time_idx" ON "working"."signals" USING btree ("case_key","observed_at");--> statement-breakpoint
CREATE INDEX "strategies_plan_idx" ON "working"."strategies" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "identified"."users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "voice_approvals_school_idx" ON "working"."voice_approvals" USING btree ("school_id");--> statement-breakpoint
-- Audit log is append-only (docs/04). Any UPDATE or DELETE is rejected at the database.
CREATE OR REPLACE FUNCTION working.audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON working.audit_events
  FOR EACH ROW EXECUTE FUNCTION working.audit_events_immutable();
--> statement-breakpoint
-- Egress log is append-only for the same reason.
CREATE TRIGGER egress_log_no_update BEFORE UPDATE OR DELETE ON working.egress_log
  FOR EACH ROW EXECUTE FUNCTION working.audit_events_immutable();
--> statement-breakpoint
-- Prompt versions are immutable once created; only status may change (promotion/retirement).
CREATE OR REPLACE FUNCTION working.prompt_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.model IS DISTINCT FROM OLD.model OR NEW.params IS DISTINCT FROM OLD.params OR NEW.surface IS DISTINCT FROM OLD.surface OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'prompt_versions are immutable except for status';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER prompt_versions_immutable BEFORE UPDATE ON working.prompt_versions
  FOR EACH ROW EXECUTE FUNCTION working.prompt_versions_immutable();
