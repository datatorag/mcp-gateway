ALTER TABLE "connected_accounts" ADD COLUMN IF NOT EXISTS "external_account_id" text;--> statement-breakpoint
ALTER TABLE "connected_accounts" ADD CONSTRAINT "uq_user_connector_email_external" UNIQUE NULLS NOT DISTINCT("user_id","connector_type","account_email","external_account_id");--> statement-breakpoint
ALTER TABLE "connected_accounts" DROP CONSTRAINT "uq_user_connector_email";
