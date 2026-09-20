CREATE SCHEMA "identified";
--> statement-breakpoint
CREATE SCHEMA "working";
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
	"grade_level" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"section_id" text NOT NULL,
	"school_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."class_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"school_id" text NOT NULL,
	"name" text NOT NULL,
	"grade_level" text NOT NULL,
	"period_tag" text
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
CREATE TABLE "working"."jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"error" text,
	"run_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"context_tag_extensions" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."pattern_candidates" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "working"."review_cycles" (
	"id" text PRIMARY KEY NOT NULL,
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
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identified"."section_enrollments" (
	"section_id" text NOT NULL,
	"student_id" text NOT NULL,
	CONSTRAINT "section_enrollments_section_id_student_id_pk" PRIMARY KEY("section_id","student_id")
);
--> statement-breakpoint
CREATE TABLE "identified"."sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "working"."signals" (
	"id" text PRIMARY KEY NOT NULL,
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
CREATE TABLE "identified"."users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"auth_subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "identified"."authorization_records" ADD CONSTRAINT "authorization_records_admin_user_id_users_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "identified"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."authorization_records" ADD CONSTRAINT "authorization_records_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "identified"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."authorization_records" ADD CONSTRAINT "authorization_records_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "identified"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."case_links" ADD CONSTRAINT "case_links_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "identified"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."class_sections" ADD CONSTRAINT "class_sections_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "identified"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."correction_requests" ADD CONSTRAINT "correction_requests_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."goals" ADD CONSTRAINT "goals_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "working"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."insufficient_data_notes" ADD CONSTRAINT "insufficient_data_notes_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."intakes" ADD CONSTRAINT "intakes_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
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
ALTER TABLE "identified"."sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "identified"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."signals" ADD CONSTRAINT "signals_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."strategies" ADD CONSTRAINT "strategies_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "working"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."students" ADD CONSTRAINT "students_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "identified"."schools"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_events_at_idx" ON "working"."audit_events" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_events_student_idx" ON "working"."audit_events" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "case_links_student_idx" ON "identified"."case_links" USING btree ("student_id");--> statement-breakpoint
CREATE INDEX "cases_section_idx" ON "working"."cases" USING btree ("section_id");--> statement-breakpoint
CREATE INDEX "cases_school_idx" ON "working"."cases" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "generation_runs_case_idx" ON "working"."generation_runs" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "goals_plan_idx" ON "working"."goals" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "insufficient_case_idx" ON "working"."insufficient_data_notes" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "jobs_status_idx" ON "working"."jobs" USING btree ("status","run_at");--> statement-breakpoint
CREATE INDEX "pattern_candidates_case_idx" ON "working"."pattern_candidates" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "pattern_candidates_status_idx" ON "working"."pattern_candidates" USING btree ("status");--> statement-breakpoint
CREATE INDEX "plan_drafts_case_idx" ON "working"."plan_drafts" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "plans_case_idx" ON "working"."plans" USING btree ("case_key");--> statement-breakpoint
CREATE INDEX "review_cycles_plan_idx" ON "working"."review_cycles" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "role_assignments_user_idx" ON "identified"."role_assignments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "signals_case_time_idx" ON "working"."signals" USING btree ("case_key","observed_at");--> statement-breakpoint
CREATE INDEX "strategies_plan_idx" ON "working"."strategies" USING btree ("plan_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_idx" ON "identified"."users" USING btree ("email");