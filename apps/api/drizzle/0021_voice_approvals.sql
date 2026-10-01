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
CREATE INDEX "voice_approvals_school_idx" ON "working"."voice_approvals" USING btree ("school_id");