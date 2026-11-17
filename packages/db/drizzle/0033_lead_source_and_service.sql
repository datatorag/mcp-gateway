ALTER TABLE "leads" ADD COLUMN "source" text DEFAULT 'demo' NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "service" text;