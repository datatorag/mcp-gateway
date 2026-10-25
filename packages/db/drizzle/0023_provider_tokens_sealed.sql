-- SCRUM-442. plugin_connections becomes sealed-only here, with no backfill,
-- so a row already in it would be left holding a token nothing can read.
-- Refuse rather than strand it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "plugin_connections") THEN
    RAISE EXCEPTION 'plugin_connections has rows; this migration makes the table sealed-only and would strand them';
  END IF;
END $$;--> statement-breakpoint
ALTER TABLE "plugin_connections" ALTER COLUMN "access_token" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plugin_connections" ADD COLUMN "access_token_sealed" text;--> statement-breakpoint
ALTER TABLE "plugin_connections" ADD COLUMN "refresh_token_sealed" text;--> statement-breakpoint
ALTER TABLE "service_connections" ADD COLUMN "access_token_sealed" text;--> statement-breakpoint
ALTER TABLE "service_connections" ADD COLUMN "refresh_token_sealed" text;