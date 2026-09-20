-- Audit log is append-only (docs/04). Any UPDATE or DELETE is rejected at the database.
CREATE OR REPLACE FUNCTION working.audit_events_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only';
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER audit_events_no_update BEFORE UPDATE OR DELETE ON working.audit_events
  FOR EACH ROW EXECUTE FUNCTION working.audit_events_immutable();
--> statement-breakpoint
-- Egress log is append-only for the same reason.
CREATE TRIGGER egress_log_no_update BEFORE UPDATE OR DELETE ON working.egress_log
  FOR EACH ROW EXECUTE FUNCTION working.audit_events_immutable();
--> statement-breakpoint
-- Prompt versions are immutable once created; only status may change (promotion/retirement).
CREATE OR REPLACE FUNCTION working.prompt_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body OR NEW.model IS DISTINCT FROM OLD.model OR NEW.params IS DISTINCT FROM OLD.params OR NEW.surface IS DISTINCT FROM OLD.surface OR NEW.version IS DISTINCT FROM OLD.version THEN
    RAISE EXCEPTION 'prompt_versions are immutable except for status';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER prompt_versions_immutable BEFORE UPDATE ON working.prompt_versions
  FOR EACH ROW EXECUTE FUNCTION working.prompt_versions_immutable();
