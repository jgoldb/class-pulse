CREATE TABLE "working"."teacher_preferences" (
	"user_id" text PRIMARY KEY NOT NULL,
	"capture_vocabulary" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
