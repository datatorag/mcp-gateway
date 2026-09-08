CREATE TABLE "skill_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"schedule_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_slug" text NOT NULL,
	"trigger" text DEFAULT 'scheduled' NOT NULL,
	"status" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"thread_id" text,
	"run_id" text,
	"tool_calls" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tool_call_count" integer DEFAULT 0 NOT NULL,
	"delivered" text,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "skill_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"skill_slug" text NOT NULL,
	"cadence" text NOT NULL,
	"hour" integer NOT NULL,
	"minute" integer DEFAULT 0 NOT NULL,
	"weekday" integer,
	"timezone" text NOT NULL,
	"paused" boolean DEFAULT false NOT NULL,
	"paused_reason" text,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_run_at" timestamp with time zone,
	"next_run_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_schedule_id_skill_schedules_id_fk" FOREIGN KEY ("schedule_id") REFERENCES "public"."skill_schedules"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_runs" ADD CONSTRAINT "skill_runs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_schedules" ADD CONSTRAINT "skill_schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_runs_schedule_started_idx" ON "skill_runs" USING btree ("schedule_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_schedules_user_skill_idx" ON "skill_schedules" USING btree ("user_id","skill_slug");--> statement-breakpoint
CREATE INDEX "skill_schedules_due_idx" ON "skill_schedules" USING btree ("paused","next_run_at");