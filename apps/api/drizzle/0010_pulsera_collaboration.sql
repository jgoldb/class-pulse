CREATE TABLE "working"."artifact_shares" (
	"publication_id" text PRIMARY KEY NOT NULL,
	"shared_by" text NOT NULL,
	"shared_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone
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
	"revision" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"response" text,
	"responded_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "working"."artifact_shares" ADD CONSTRAINT "artifact_shares_publication_id_artifact_publications_id_fk" FOREIGN KEY ("publication_id") REFERENCES "working"."artifact_publications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."classroom_help_requests" ADD CONSTRAINT "classroom_help_requests_learner_key_learners_learner_key_fk" FOREIGN KEY ("learner_key") REFERENCES "working"."learners"("learner_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."contribution_responses" ADD CONSTRAINT "contribution_responses_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "working"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."contribution_revisions" ADD CONSTRAINT "contribution_revisions_contribution_id_contributions_id_fk" FOREIGN KEY ("contribution_id") REFERENCES "working"."contributions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."contributions" ADD CONSTRAINT "contributions_learner_key_learners_learner_key_fk" FOREIGN KEY ("learner_key") REFERENCES "working"."learners"("learner_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_help_request_idx" ON "working"."classroom_help_requests" USING btree ("created_by","request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_revision_idx" ON "working"."contribution_revisions" USING btree ("contribution_id","revision");--> statement-breakpoint
CREATE UNIQUE INDEX "contribution_request_idx" ON "working"."contribution_revisions" USING btree ("created_by","request_id");--> statement-breakpoint
CREATE INDEX "contributions_recipient_idx" ON "working"."contributions" USING btree ("recipient_id","section_id");