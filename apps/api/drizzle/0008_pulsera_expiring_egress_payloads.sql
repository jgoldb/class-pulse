CREATE TABLE "working"."classroom_egress_payloads" (
	"run_id" text PRIMARY KEY NOT NULL,
	"input" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
