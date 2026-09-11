-- SCRUM-245: api_keys exists in production but no migration file ever
-- created it (the snapshots carry it since 0003; the table was made by hand),
-- so a fresh environment lacks the table the machine-credential path reads.
-- Idempotent on purpose: a no-op where the table already exists, the table
-- and its constraints where it does not. Shape mirrors
-- packages/db/src/schema/api-keys.ts and the production table column for
-- column.
CREATE TABLE IF NOT EXISTS "api_keys" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL,
  "name" text NOT NULL,
  "key_hash" text NOT NULL,
  "key_prefix" text NOT NULL,
  "last_used_at" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_keys_user_id_users_id_fk'
  ) THEN
    ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk"
      FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;
