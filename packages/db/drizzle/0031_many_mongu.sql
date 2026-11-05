-- Two tables nothing reads any more. plugin_connections held the tokens of
-- the legacy manifest-OAuth connect flow, whose routes and reader were
-- removed; credit_balances backed a credits model that never shipped, and
-- only the development seed wrote it.
--
-- Refuse rather than drop what someone may still need: any plugin
-- connection at all, or more credit balances than the seed's one row.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "plugin_connections") THEN
    RAISE EXCEPTION 'plugin_connections has rows; this migration drops the table';
  END IF;
  IF (SELECT count(*) FROM "credit_balances") > 1 THEN
    RAISE EXCEPTION 'credit_balances has more than one row; this migration drops the table';
  END IF;
END $$;--> statement-breakpoint
DROP TABLE "credit_balances" CASCADE;--> statement-breakpoint
DROP TABLE "plugin_connections" CASCADE;
