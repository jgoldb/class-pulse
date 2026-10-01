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
	"deferred_until" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classroom_drafts_generation_key_unique" UNIQUE("generation_key")
);
--> statement-breakpoint
ALTER TABLE "working"."artifact_publications" ADD CONSTRAINT "artifact_publications_draft_id_classroom_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "working"."classroom_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."artifact_revisions" ADD CONSTRAINT "artifact_revisions_draft_id_classroom_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "working"."classroom_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."classroom_drafts" ADD CONSTRAINT "classroom_drafts_session_id_class_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "working"."class_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_publication_idx" ON "working"."artifact_publications" USING btree ("draft_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "artifact_revision_idx" ON "working"."artifact_revisions" USING btree ("draft_id","revision");--> statement-breakpoint
CREATE INDEX "classroom_drafts_owner_idx" ON "working"."classroom_drafts" USING btree ("created_by","section_id");