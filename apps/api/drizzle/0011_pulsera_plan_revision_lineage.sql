CREATE TABLE "working"."classroom_plan_origins" (
	"draft_id" text PRIMARY KEY NOT NULL,
	"base_plan_id" text NOT NULL,
	"section_id" text NOT NULL,
	"created_by" text NOT NULL,
	"request_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"sources" jsonb NOT NULL,
	"invalidated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "working"."plans" ADD COLUMN "source_review_needed" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "working"."classroom_plan_origins" ADD CONSTRAINT "classroom_plan_origins_draft_id_plan_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "working"."plan_drafts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "classroom_plan_request_idx" ON "working"."classroom_plan_origins" USING btree ("created_by","request_id");