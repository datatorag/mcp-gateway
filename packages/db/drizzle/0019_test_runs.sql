CREATE TABLE "test_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"case_id" text NOT NULL,
	"kind" text NOT NULL,
	"status" text NOT NULL,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"cleanup" text DEFAULT 'none_needed' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "test_results_run_case_uq" UNIQUE("run_id","case_id")
);
--> statement-breakpoint
CREATE TABLE "test_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"triggered_by" uuid NOT NULL,
	"trigger" text NOT NULL,
	"scope" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" text NOT NULL,
	"environment" text NOT NULL,
	"imported_from" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	"gateway_sha" text,
	"plugin_shas" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"tools_served" integer DEFAULT 0 NOT NULL,
	"totals" jsonb DEFAULT '{"pass":0,"fail":0,"skip":0,"uncovered":0}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "test_results" ADD CONSTRAINT "test_results_run_id_test_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."test_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_triggered_by_users_id_fk" FOREIGN KEY ("triggered_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "test_runs_started_at_idx" ON "test_runs" USING btree ("started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "test_runs_one_running_uq" ON "test_runs" USING btree ("status") WHERE status = 'running';