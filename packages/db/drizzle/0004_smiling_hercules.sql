-- leads table + indexes omitted: already created by the hand-written
-- 0004_leads.sql (outside drizzle meta); this migration only adds the
-- activation milestone column.
ALTER TABLE "users" ADD COLUMN "first_tool_call_at" timestamp with time zone;
