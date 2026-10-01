ALTER TABLE "identified"."organizations" ALTER COLUMN "pulsera_enabled" SET DEFAULT true;--> statement-breakpoint
-- Class Pulse is the teacher's home, so existing workspaces get it too — but only where every
-- learner is synthetic, matching the check services/pulse.ts#configurePulse applies when an
-- administrator enables it. Demonstration posture is still required at runtime.
UPDATE "identified"."organizations" o SET "pulsera_enabled" = true
WHERE NOT EXISTS (
  SELECT 1 FROM "identified"."students" s
  JOIN "identified"."schools" sc ON sc."id" = s."school_id"
  WHERE sc."org_id" = o."id" AND s."synthetic" = false
);
