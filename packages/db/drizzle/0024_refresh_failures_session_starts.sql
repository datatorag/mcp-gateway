CREATE TABLE "mcp_session_starts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"connected_account_id" uuid NOT NULL,
	"client_name" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "service_connections" ADD COLUMN "last_refresh_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_connections" ADD COLUMN "last_refresh_error" text;--> statement-breakpoint
ALTER TABLE "service_connections" ADD COLUMN "refresh_permanent_failures" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "mcp_session_starts" ADD CONSTRAINT "mcp_session_starts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mcp_session_starts" ADD CONSTRAINT "mcp_session_starts_connected_account_id_connected_accounts_id_fk" FOREIGN KEY ("connected_account_id") REFERENCES "public"."connected_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_mcp_session_starts_account_started" ON "mcp_session_starts" USING btree ("connected_account_id","started_at");