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
CREATE TABLE "working"."seating_layouts" (
	"id" text PRIMARY KEY NOT NULL,
	"section_id" text NOT NULL,
	"version" integer NOT NULL,
	"positions" jsonb NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "working"."cases" ADD COLUMN "learner_key" text;--> statement-breakpoint
ALTER TABLE "identified"."organizations" ADD COLUMN "pulsera_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "identified"."schools" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "working"."classroom_events" ADD CONSTRAINT "classroom_events_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "working"."class_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."event_revisions" ADD CONSTRAINT "event_revisions_event_id_classroom_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "working"."classroom_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."event_revisions" ADD CONSTRAINT "event_revisions_learner_key_learners_learner_key_fk" FOREIGN KEY ("learner_key") REFERENCES "working"."learners"("learner_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."learner_links" ADD CONSTRAINT "learner_links_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "identified"."students"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identified"."learner_links" ADD CONSTRAINT "learner_links_learner_key_learners_learner_key_fk" FOREIGN KEY ("learner_key") REFERENCES "working"."learners"("learner_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_request_idx" ON "working"."class_sessions" USING btree ("teacher_id","request_id");--> statement-breakpoint
CREATE INDEX "session_section_date_idx" ON "working"."class_sessions" USING btree ("section_id","date");--> statement-breakpoint
CREATE INDEX "classroom_events_session_idx" ON "working"."classroom_events" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "event_revision_idx" ON "working"."event_revisions" USING btree ("event_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "event_request_idx" ON "working"."event_revisions" USING btree ("created_by","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "seating_section_version_idx" ON "working"."seating_layouts" USING btree ("section_id","version");--> statement-breakpoint
ALTER TABLE "working"."cases" ADD CONSTRAINT "cases_learner_key_learners_learner_key_fk" FOREIGN KEY ("learner_key") REFERENCES "working"."learners"("learner_key") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
-- Repeatable identity-only backfill. No content, timestamps, or approvals are synthesized.
DO $$
DECLARE student_row RECORD; new_key TEXT;
BEGIN
  FOR student_row IN SELECT s.id FROM identified.students s
    LEFT JOIN identified.learner_links l ON l.student_id = s.id WHERE l.student_id IS NULL
  LOOP
    new_key := 'lk_' || gen_random_uuid()::text;
    INSERT INTO working.learners (learner_key) VALUES (new_key);
    INSERT INTO identified.learner_links (student_id, learner_key) VALUES (student_row.id, new_key);
  END LOOP;
  UPDATE working.cases c SET learner_key = l.learner_key
    FROM identified.case_links cl JOIN identified.learner_links l ON l.student_id = cl.student_id
    WHERE c.case_key = cl.case_key AND c.learner_key IS NULL;
END $$;
