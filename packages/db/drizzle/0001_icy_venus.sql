DROP INDEX "idx_usage_events_user_tool";--> statement-breakpoint
CREATE INDEX "idx_usage_events_user_tool_created" ON "usage_events" USING btree ("user_id","tool_name","created_at" DESC NULLS LAST);