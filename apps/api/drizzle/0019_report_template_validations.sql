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
CREATE INDEX "report_template_validation_idx" ON "working"."report_template_validations" USING btree ("school_id","kind");