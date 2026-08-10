import type { Database } from "@datatorag-mcp/db";
import { sql } from "drizzle-orm";

export async function runDailyRollup(
  db: Database,
  now: Date = new Date()
): Promise<void> {
  const yesterday = new Date(now.getTime() - 24 * 3600_000);
  const day = yesterday.toISOString().slice(0, 10);

  console.log(`[rollup] aggregating ${day}`);
  await db.execute(sql`
    INSERT INTO usage_events_daily (day, user_id, tool_name, connector, calls, errors, p50_ms, p95_ms, total_bytes)
    SELECT
      ${day}::date AS day,
      user_id,
      tool_name,
      connector,
      count(*)::int AS calls,
      count(*) filter (where status = 'user_error')::int AS errors,
      -- Calls and bytes count every row. The percentiles skip rows whose
      -- latency was never measured, so a duration nobody recorded cannot be
      -- rolled up as if it were zero. See usage/exclusions.ts for what those
      -- rows are and why they are not backfilled.
      percentile_cont(0.5) within group (order by latency_ms)
        filter (where connector is not null)::int AS p50_ms,
      percentile_cont(0.95) within group (order by latency_ms)
        filter (where connector is not null)::int AS p95_ms,
      coalesce(sum(response_size_bytes), 0)::int AS total_bytes
    FROM usage_events
    WHERE created_at >= ${day}::date
      AND created_at <  (${day}::date + INTERVAL '1 day')
    GROUP BY user_id, tool_name, connector
    ON CONFLICT (day, user_id, tool_name) DO UPDATE SET
      connector = EXCLUDED.connector,
      calls = EXCLUDED.calls,
      errors = EXCLUDED.errors,
      p50_ms = EXCLUDED.p50_ms,
      p95_ms = EXCLUDED.p95_ms,
      total_bytes = EXCLUDED.total_bytes
  `);

  console.log(`[rollup] pruning events older than 90 days`);
  await db.execute(
    sql`DELETE FROM usage_events WHERE created_at < now() - INTERVAL '90 days'`
  );
  console.log(`[rollup] done`);
}
