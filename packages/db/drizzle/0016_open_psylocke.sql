CREATE TABLE "agent_run_usage" (
	"run_id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"thread_id" text NOT NULL,
	"skill" text,
	"model" text NOT NULL,
	"steps" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"cache_write_tokens" integer DEFAULT 0 NOT NULL,
	"output_tokens" integer DEFAULT 0 NOT NULL,
	"reasoning_tokens" integer DEFAULT 0 NOT NULL,
	"weighted_tokens" integer DEFAULT 0 NOT NULL,
	"cost_usd" numeric(12, 6),
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent_run_usage" ADD CONSTRAINT "agent_run_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_agent_run_usage_user_started" ON "agent_run_usage" USING btree ("user_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_agent_run_usage_thread" ON "agent_run_usage" USING btree ("thread_id");