ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "resource" text;--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "param_names" text;