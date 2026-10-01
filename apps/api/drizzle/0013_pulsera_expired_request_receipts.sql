CREATE TABLE "working"."expired_classroom_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"created_by" text NOT NULL,
	"request_id" text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "expired_classroom_requests_unique" ON "working"."expired_classroom_requests" USING btree ("kind","created_by","request_id");