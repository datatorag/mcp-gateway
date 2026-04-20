import { sql, type SQL } from "drizzle-orm";
import { usageEvents } from "@datatorag-mcp/db";

export const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;
export type RangeKey = keyof typeof RANGES;

export interface UsageRange {
  range: RangeKey;
  days: number;
  start: Date;
  bucket: "hour" | "day";
  /** `date_trunc('hour' | 'day', usage_events.created_at)` — reusable across SELECT/GROUP BY/ORDER BY */
  truncExpr: SQL;
}

export function parseUsageRange(req: Request): UsageRange {
  const url = new URL(req.url);
  const range = (url.searchParams.get("range") ?? "7d") as RangeKey;
  const days = RANGES[range] ?? 7;
  const start = new Date(Date.now() - days * 24 * 3600_000);
  const bucket: "hour" | "day" = days <= 1 ? "hour" : "day";
  const truncExpr =
    bucket === "hour"
      ? sql`date_trunc('hour', ${usageEvents.createdAt})`
      : sql`date_trunc('day', ${usageEvents.createdAt})`;
  return { range, days, start, bucket, truncExpr };
}
