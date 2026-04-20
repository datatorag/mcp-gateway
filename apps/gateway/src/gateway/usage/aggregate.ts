export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.min(
    sorted.length - 1,
    Math.floor((p / 100) * sorted.length)
  );
  return sorted[idx];
}

export function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export type Granularity = "hour" | "day";

export interface BucketSpec {
  granularity: Granularity;
  count: number;
}

const HOUR_MS = 3600_000;
const DAY_MS = 24 * HOUR_MS;

export function timeBuckets(start: Date, end: Date): BucketSpec {
  const spanMs = end.getTime() - start.getTime();
  if (spanMs <= 24 * HOUR_MS) {
    return { granularity: "hour", count: Math.round(spanMs / HOUR_MS) };
  }
  return { granularity: "day", count: Math.round(spanMs / DAY_MS) };
}
