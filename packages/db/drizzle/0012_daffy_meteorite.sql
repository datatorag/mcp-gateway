-- TWO-PHASE MIGRATION, so every statement is idempotent — this is deliberate,
-- not sloppiness, and mirrors how 0009 shipped. The first two effects (the
-- stripe_events table and the plan default) were applied to production ahead
-- of the deploy, out-of-band, because they are safe under the old build and
-- closed a live signup leak; the column drop must wait until the new build is
-- live, because the old build selects every users column on login. migrate()
-- therefore runs this against a database that already has the first half, and
-- a plain CREATE TABLE here fails with 42P07 at exactly the wrong moment.
CREATE TABLE IF NOT EXISTS "stripe_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "plan" SET DEFAULT 'free';--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN IF EXISTS "trial_ends_at";
