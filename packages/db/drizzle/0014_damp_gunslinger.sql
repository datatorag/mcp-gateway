CREATE TABLE "skills" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid,
	"visibility" text NOT NULL,
	"slug" text NOT NULL,
	"version" text NOT NULL,
	"title" text NOT NULL,
	"situation" text DEFAULT '' NOT NULL,
	"produces" text DEFAULT '' NOT NULL,
	"tools" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"accounts" text DEFAULT 'single' NOT NULL,
	"order" integer DEFAULT 99 NOT NULL,
	"intro" text DEFAULT '' NOT NULL,
	"source" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"forked_from_slug" text,
	"forked_from_version" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "skills" ADD CONSTRAINT "skills_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "skills_current_idx" ON "skills" USING btree (coalesce("owner_id"::text, 'published'),"slug") WHERE superseded_at IS NULL AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "skills_owner_slug_current_idx" ON "skills" USING btree ("owner_id","slug","superseded_at");--> statement-breakpoint
CREATE INDEX "skills_owner_idx" ON "skills" USING btree ("owner_id","deleted_at","superseded_at");--> statement-breakpoint
CREATE INDEX "skills_slug_idx" ON "skills" USING btree ("slug");