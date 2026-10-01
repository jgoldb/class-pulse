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
ALTER TABLE "working"."follow_up_tasks" ADD CONSTRAINT "follow_up_tasks_draft_id_classroom_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "working"."classroom_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "follow_up_request_idx" ON "working"."follow_up_tasks" USING btree ("created_by","request_id");--> statement-breakpoint
CREATE INDEX "follow_up_owner_idx" ON "working"."follow_up_tasks" USING btree ("owner_id","due_date");