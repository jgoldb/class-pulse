CREATE TABLE "working"."tomorrow_schedules" (
	"section_id" text NOT NULL,
	"teacher_id" text NOT NULL,
	"settings" jsonb NOT NULL,
	"last_prepared_date" text,
	"last_result" text,
	"target_date" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tomorrow_schedules_section_id_teacher_id_pk" PRIMARY KEY("section_id","teacher_id")
);
