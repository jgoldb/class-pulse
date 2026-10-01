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
ALTER TABLE "working"."classroom_drafts" ADD COLUMN "run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "working"."pattern_candidates" ADD COLUMN "source_invalidated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "working"."signals" ADD COLUMN "retired_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "working"."signal_projections" ADD CONSTRAINT "signal_projections_event_id_classroom_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "working"."classroom_events"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."signal_projections" ADD CONSTRAINT "signal_projections_case_key_cases_case_key_fk" FOREIGN KEY ("case_key") REFERENCES "working"."cases"("case_key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "working"."signal_projections" ADD CONSTRAINT "signal_projections_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "working"."signals"("id") ON DELETE no action ON UPDATE no action;