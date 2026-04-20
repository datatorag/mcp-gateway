# Usage Metrics + Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Log every metered MCP tool call to Postgres and surface it in a new `/dashboard/usage` section. Forward-compatible with a future Stripe Meters billing layer.

**Architecture:** Dual-write `trackToolCall` to PostHog (analytics, unchanged) and to a new `usage_events` Postgres table (metering SoT). Synchronous insert with 200ms timeout — tool call succeeds even if the insert fails. A daily rollup (`usage_events_daily`) retains history forever while raw rows are pruned at 90 days. A React dashboard reads from Postgres via session-scoped API routes.

**Tech Stack:** Next.js App Router, Express custom server, Drizzle ORM, PostgreSQL 16, PostHog (existing), Vitest (new), Recharts (new), node-cron (new — for rollups, see Task 16 for pg_cron alternative).

---

## File Structure

### New files

| Path | Responsibility |
|------|----------------|
| `apps/gateway/vitest.config.ts` | Vitest config (node environment) |
| `apps/gateway/src/gateway/usage/redact.ts` | Strip PII (emails, Google IDs, long quoted strings) from error messages |
| `apps/gateway/src/gateway/usage/redact.test.ts` | Redactor unit tests |
| `apps/gateway/src/gateway/usage/classify.ts` | Classify tool-call outcome into `billable` or `not_counted` with status type |
| `apps/gateway/src/gateway/usage/classify.test.ts` | Classifier unit tests |
| `apps/gateway/src/gateway/usage/aggregate.ts` | Pure helpers for p50/p95/avg + time-bucket helpers |
| `apps/gateway/src/gateway/usage/aggregate.test.ts` | Aggregation helper tests |
| `apps/gateway/src/gateway/usage/write.ts` | Synchronous Postgres insert with 200ms timeout |
| `apps/gateway/src/gateway/usage/write.test.ts` | Write-path timeout and error-handling tests |
| `apps/gateway/src/gateway/usage/rate-limit.ts` | In-memory sliding-window rate limiter (120 req/min per user) |
| `apps/gateway/src/gateway/usage/rate-limit.test.ts` | Rate-limit tests |
| `apps/gateway/src/gateway/usage/rollup.ts` | Daily aggregation job: usage_events → usage_events_daily + prune |
| `apps/gateway/src/gateway/usage/rollup.test.ts` | Rollup logic tests |
| `packages/db/src/schema/usage.ts` | Drizzle schema for `usage_events` + `usage_events_daily` |
| `packages/db/drizzle/000X_usage_events.sql` | Generated migration |
| `apps/gateway/src/app/api/usage/summary/route.ts` | GET — total calls MTD, success %, p95 latency |
| `apps/gateway/src/app/api/usage/timeseries/route.ts` | GET — call volume bucketed by hour/day, auto-switch table |
| `apps/gateway/src/app/api/usage/by-tool/route.ts` | GET — per-tool metrics for table + top-10 bar |
| `apps/gateway/src/app/api/usage/recent/route.ts` | GET — last 50 events for activity feed |
| `apps/gateway/src/app/api/usage/by-connector/route.ts` | GET — per-connector counts for stacked bar |
| `apps/gateway/src/lib/with-rate-limit.ts` | HOF wrapping API handlers with user session + rate-limit check |
| `apps/gateway/src/app/dashboard/usage/page.tsx` | Server component — session gate, passes userId to client |
| `apps/gateway/src/app/dashboard/usage/usage-client.tsx` | Client component — cards, filters, charts, table |
| `apps/gateway/src/app/dashboard/usage/[tool]/page.tsx` | Drill-down page for a single tool |

### Modified files

| Path | Change |
|------|--------|
| `apps/gateway/package.json` | Add `vitest`, `@types/node`, `recharts`, `node-cron`, `@types/node-cron` |
| `apps/gateway/src/gateway/track.ts` | `trackToolCall` signature widens status to `"success" \| "user_error" \| "server_error"`; adds synchronous `writeUsageEvent` call |
| `apps/gateway/src/gateway/mcp-server.ts` | Both `trackToolCall` call sites pass new status classification and call `shouldMeter(...)` guard |
| `apps/gateway/server.ts` | Start node-cron scheduler; shutdown hook stops it |
| `apps/gateway/src/app/dashboard/layout.tsx` | Add `{ href: "/dashboard/usage", label: "Usage" }` between Dashboard and Docs |
| `packages/db/src/schema/index.ts` | Re-export `usage` schema |

---

## Phase 1 — Test infrastructure

### Task 1: Install Vitest

**Files:**
- Modify: `apps/gateway/package.json`
- Create: `apps/gateway/vitest.config.ts`

- [ ] **Step 1:** Install Vitest + types

```bash
cd /Users/myang/git/datatorag-mcp
pnpm --filter gateway add -D vitest @vitest/ui
```

- [ ] **Step 2:** Create `apps/gateway/vitest.config.ts`

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    globals: false,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
```

- [ ] **Step 3:** Add test script to `apps/gateway/package.json` scripts block

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4:** Run to confirm zero tests detected

```bash
pnpm --filter gateway test
```

Expected: "No test files found" (exits 0 or 1; both OK — Vitest is wired).

- [ ] **Step 5:** Commit

```bash
git add apps/gateway/package.json apps/gateway/vitest.config.ts pnpm-lock.yaml
git commit -m "Add Vitest for unit tests"
```

---

## Phase 2 — Pure utility functions (TDD)

### Task 2: PII redactor

**Files:**
- Create: `apps/gateway/src/gateway/usage/redact.ts`
- Create: `apps/gateway/src/gateway/usage/redact.test.ts`

- [ ] **Step 1:** Write `apps/gateway/src/gateway/usage/redact.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { redactErrorMessage } from "./redact";

describe("redactErrorMessage", () => {
  it("returns null for null input", () => {
    expect(redactErrorMessage(null)).toBeNull();
  });

  it("returns empty string unchanged", () => {
    expect(redactErrorMessage("")).toBe("");
  });

  it("masks email addresses", () => {
    const input = "failed to send to alice@example.com and bob.smith+tag@acme.co";
    const out = redactErrorMessage(input);
    expect(out).not.toContain("alice@example.com");
    expect(out).not.toContain("bob.smith+tag@acme.co");
    expect(out).toContain("[redacted-email]");
  });

  it("masks Google Drive file IDs", () => {
    const input = "file 1BxABcDeFgHiJkLmNoPqRsTuVwXyZ01234 not found";
    const out = redactErrorMessage(input);
    expect(out).not.toContain("1BxABcDeFgHiJkLmNoPqRsTuVwXyZ01234");
    expect(out).toContain("[redacted-id]");
  });

  it("masks Google Doc URL IDs", () => {
    const input = "https://docs.google.com/document/d/1BxABcDeFgHi_jkLmNoPqRsTuVwXyZ/edit";
    const out = redactErrorMessage(input);
    expect(out).not.toContain("1BxABcDeFgHi_jkLmNoPqRsTuVwXyZ");
  });

  it("masks Calendar event IDs", () => {
    const input = "event abc123def456ghi789jkl012 does not exist";
    const out = redactErrorMessage(input);
    expect(out).not.toContain("abc123def456ghi789jkl012");
  });

  it("masks quoted strings longer than 40 chars", () => {
    const input = 'subject was "The quick brown fox jumps over the lazy dog today"';
    const out = redactErrorMessage(input);
    expect(out).not.toContain("The quick brown fox jumps over the lazy dog today");
    expect(out).toContain('"[redacted-content]"');
  });

  it("keeps short quoted strings", () => {
    const input = 'field "title" is required';
    const out = redactErrorMessage(input);
    expect(out).toContain('"title"');
  });

  it("truncates long outputs to 500 chars", () => {
    const input = "x".repeat(2000);
    const out = redactErrorMessage(input);
    expect(out!.length).toBeLessThanOrEqual(500);
  });
});
```

- [ ] **Step 2:** Run, expect failures

```bash
pnpm --filter gateway test -- redact
```

Expected: FAIL — "redact" module not found.

- [ ] **Step 3:** Implement `apps/gateway/src/gateway/usage/redact.ts`

```ts
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// Google Drive / Docs / Sheets / Slides IDs: alphanumeric with -_, 20+ chars
const GOOGLE_ID_RE = /\b[A-Za-z0-9_-]{20,}\b/g;
// Quoted strings longer than 40 chars (inside single or double quotes)
const LONG_QUOTED_RE = /(["'])([^"'\n]{41,})\1/g;

const MAX_LEN = 500;

export function redactErrorMessage(input: string | null): string | null {
  if (input === null) return null;
  if (input === "") return "";
  let out = input;
  out = out.replace(EMAIL_RE, "[redacted-email]");
  out = out.replace(LONG_QUOTED_RE, (_m, q) => `${q}[redacted-content]${q}`);
  out = out.replace(GOOGLE_ID_RE, "[redacted-id]");
  if (out.length > MAX_LEN) out = out.slice(0, MAX_LEN);
  return out;
}
```

- [ ] **Step 4:** Run, expect pass

```bash
pnpm --filter gateway test -- redact
```

Expected: 9 passing.

- [ ] **Step 5:** Commit

```bash
git add apps/gateway/src/gateway/usage/redact.ts apps/gateway/src/gateway/usage/redact.test.ts
git commit -m "Add PII redactor for usage event error messages"
```

---

### Task 3: Metering rule classifier

**Files:**
- Create: `apps/gateway/src/gateway/usage/classify.ts`
- Create: `apps/gateway/src/gateway/usage/classify.test.ts`

**Design:** Classifier takes tool-call outcome info and returns `{ status: "success" | "user_error" | "server_error" | "not_counted", meter: boolean }`. Meter=true means the event gets written to usage_events.

Decisions locked by spec:
- Counted: success + user_error (2xx + 4xx)
- Not counted: server_error (5xx, timeouts), OAuth/token refresh, playground calls

- [ ] **Step 1:** Write `classify.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { classifyOutcome } from "./classify";

describe("classifyOutcome", () => {
  it("classifies successful tool call as success + metered", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: false,
      source: "mcp",
    });
    expect(r).toEqual({ status: "success", meter: true });
  });

  it("classifies MCP isError=true with 4xx-like message as user_error + metered", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: true,
      errorMessage: "Invalid argument: message_id is required",
      source: "mcp",
    });
    expect(r).toEqual({ status: "user_error", meter: true });
  });

  it("classifies thrown exception with timeout as server_error + not metered", () => {
    const r = classifyOutcome({
      thrown: true,
      errorMessage: "Request timed out after 30s",
      source: "mcp",
    });
    expect(r).toEqual({ status: "server_error", meter: false });
  });

  it("classifies thrown exception with 5xx-like message as server_error + not metered", () => {
    const r = classifyOutcome({
      thrown: true,
      errorMessage: "500 Internal Server Error from upstream",
      source: "mcp",
    });
    expect(r).toEqual({ status: "server_error", meter: false });
  });

  it("classifies thrown exception with generic error as server_error + not metered", () => {
    const r = classifyOutcome({
      thrown: true,
      errorMessage: "ECONNREFUSED",
      source: "mcp",
    });
    expect(r).toEqual({ status: "server_error", meter: false });
  });

  it("does not meter playground calls regardless of status", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: false,
      source: "playground",
    });
    expect(r.meter).toBe(false);
  });

  it("does not meter oauth-refresh tool calls", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: false,
      source: "mcp",
      toolName: "gws_auth_refresh",
    });
    expect(r.meter).toBe(false);
  });
});
```

- [ ] **Step 2:** Run, expect failures

- [ ] **Step 3:** Implement `classify.ts`

```ts
export type OutcomeStatus = "success" | "user_error" | "server_error";

export interface ClassifyInput {
  thrown: boolean;
  isError?: boolean;
  errorMessage?: string | null;
  source: "mcp" | "playground";
  toolName?: string;
}

export interface ClassifyResult {
  status: OutcomeStatus;
  meter: boolean;
}

const NON_METERED_TOOLS = new Set(["gws_auth_setup", "gws_auth_refresh"]);

export function classifyOutcome(input: ClassifyInput): ClassifyResult {
  const isPlayground = input.source === "playground";
  const isNonMeteredTool = input.toolName
    ? NON_METERED_TOOLS.has(input.toolName)
    : false;

  if (input.thrown) {
    return { status: "server_error", meter: false };
  }
  if (input.isError) {
    return {
      status: "user_error",
      meter: !isPlayground && !isNonMeteredTool,
    };
  }
  return {
    status: "success",
    meter: !isPlayground && !isNonMeteredTool,
  };
}
```

- [ ] **Step 4:** Run, expect 7 passing.

- [ ] **Step 5:** Commit

```bash
git add apps/gateway/src/gateway/usage/classify.ts apps/gateway/src/gateway/usage/classify.test.ts
git commit -m "Add metering rule classifier for tool-call outcomes"
```

---

### Task 4: Aggregation helpers

**Files:**
- Create: `apps/gateway/src/gateway/usage/aggregate.ts`
- Create: `apps/gateway/src/gateway/usage/aggregate.test.ts`

- [ ] **Step 1:** Write `aggregate.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { percentile, avg, timeBuckets } from "./aggregate";

describe("percentile", () => {
  it("returns 0 for empty array", () => {
    expect(percentile([], 50)).toBe(0);
  });
  it("returns single value for single-element array", () => {
    expect(percentile([42], 95)).toBe(42);
  });
  it("computes p50 of sorted list", () => {
    expect(percentile([10, 20, 30, 40, 50], 50)).toBe(30);
  });
  it("computes p95 of sorted list", () => {
    expect(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95)).toBe(10);
  });
  it("handles unsorted input", () => {
    expect(percentile([50, 10, 30, 40, 20], 50)).toBe(30);
  });
});

describe("avg", () => {
  it("returns 0 for empty array", () => {
    expect(avg([])).toBe(0);
  });
  it("computes mean", () => {
    expect(avg([10, 20, 30])).toBe(20);
  });
});

describe("timeBuckets", () => {
  it("returns hourly buckets for a 24h range", () => {
    const start = new Date("2026-04-20T00:00:00Z");
    const end = new Date("2026-04-21T00:00:00Z");
    const buckets = timeBuckets(start, end);
    expect(buckets.granularity).toBe("hour");
    expect(buckets.count).toBe(24);
  });
  it("returns daily buckets for 7d range", () => {
    const start = new Date("2026-04-13T00:00:00Z");
    const end = new Date("2026-04-20T00:00:00Z");
    const buckets = timeBuckets(start, end);
    expect(buckets.granularity).toBe("day");
    expect(buckets.count).toBe(7);
  });
  it("returns daily buckets for 30d range", () => {
    const start = new Date("2026-03-21T00:00:00Z");
    const end = new Date("2026-04-20T00:00:00Z");
    const buckets = timeBuckets(start, end);
    expect(buckets.granularity).toBe("day");
    expect(buckets.count).toBe(30);
  });
});
```

- [ ] **Step 2:** Run, expect failures.

- [ ] **Step 3:** Implement `aggregate.ts`

```ts
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
```

- [ ] **Step 4:** Run, expect 11 passing.

- [ ] **Step 5:** Commit

```bash
git add apps/gateway/src/gateway/usage/aggregate.ts apps/gateway/src/gateway/usage/aggregate.test.ts
git commit -m "Add aggregation helpers (percentile, avg, time buckets)"
```

---

### Task 5: Rate limiter

**Files:**
- Create: `apps/gateway/src/gateway/usage/rate-limit.ts`
- Create: `apps/gateway/src/gateway/usage/rate-limit.test.ts`

**Design:** In-memory sliding window. `Map<userId, number[]>` where the array is timestamps. Each `check(userId)` prunes entries older than 60s, then returns `{ ok: bool, retryAfterMs }`.

- [ ] **Step 1:** Write `rate-limit.test.ts`

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to N requests per window", () => {
    const rl = createRateLimiter({ limit: 3, windowMs: 60_000 });
    expect(rl.check("u1").ok).toBe(true);
    expect(rl.check("u1").ok).toBe(true);
    expect(rl.check("u1").ok).toBe(true);
    const r = rl.check("u1");
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBeGreaterThan(0);
  });

  it("tracks users independently", () => {
    const rl = createRateLimiter({ limit: 1, windowMs: 60_000 });
    expect(rl.check("u1").ok).toBe(true);
    expect(rl.check("u2").ok).toBe(true);
    expect(rl.check("u1").ok).toBe(false);
  });

  it("expires old entries so new calls are allowed", () => {
    let now = 1000;
    const rl = createRateLimiter({
      limit: 2,
      windowMs: 1000,
      clock: () => now,
    });
    expect(rl.check("u1").ok).toBe(true);
    expect(rl.check("u1").ok).toBe(true);
    expect(rl.check("u1").ok).toBe(false);
    now = 2500; // 1.5s later — both entries expired
    expect(rl.check("u1").ok).toBe(true);
  });

  it("returns accurate retryAfterMs", () => {
    let now = 0;
    const rl = createRateLimiter({
      limit: 1,
      windowMs: 1000,
      clock: () => now,
    });
    rl.check("u1");
    now = 200;
    const r = rl.check("u1");
    expect(r.ok).toBe(false);
    expect(r.retryAfterMs).toBe(800);
  });
});
```

- [ ] **Step 2:** Run, expect failures.

- [ ] **Step 3:** Implement `rate-limit.ts`

```ts
export interface RateLimiterOpts {
  limit: number;
  windowMs: number;
  clock?: () => number;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterMs: number;
}

export interface RateLimiter {
  check(userId: string): RateLimitResult;
}

export function createRateLimiter(opts: RateLimiterOpts): RateLimiter {
  const clock = opts.clock ?? (() => Date.now());
  const buckets = new Map<string, number[]>();

  return {
    check(userId: string): RateLimitResult {
      const now = clock();
      const cutoff = now - opts.windowMs;
      const arr = buckets.get(userId) ?? [];
      const pruned = arr.filter((t) => t > cutoff);
      if (pruned.length >= opts.limit) {
        const oldest = pruned[0];
        const retryAfterMs = Math.max(1, oldest + opts.windowMs - now);
        buckets.set(userId, pruned);
        return { ok: false, retryAfterMs };
      }
      pruned.push(now);
      buckets.set(userId, pruned);
      return { ok: true, retryAfterMs: 0 };
    },
  };
}

export const dashboardApiLimiter = createRateLimiter({
  limit: 120,
  windowMs: 60_000,
});
```

- [ ] **Step 4:** Run, expect 4 passing.

- [ ] **Step 5:** Commit

```bash
git add apps/gateway/src/gateway/usage/rate-limit.ts apps/gateway/src/gateway/usage/rate-limit.test.ts
git commit -m "Add in-memory sliding-window rate limiter"
```

---

## Phase 3 — Schema + migration

### Task 6: Drizzle schema for `usage_events` + `usage_events_daily`

**Files:**
- Create: `packages/db/src/schema/usage.ts`
- Modify: `packages/db/src/schema/index.ts`

- [ ] **Step 1:** Create `packages/db/src/schema/usage.ts`

```ts
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
  date,
  primaryKey,
} from "drizzle-orm/pg-core";
import { users } from "./users";

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    connector: text("connector"),
    accountEmail: text("account_email"),
    status: text("status").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    responseSizeBytes: integer("response_size_bytes"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // Forward-compatible nullable columns for Stripe Meters
    idempotencyKey: text("idempotency_key"),
    costUnits: integer("cost_units"),
    argumentsSizeBytes: integer("arguments_size_bytes"),
    client: text("client"),
  },
  (table) => [
    index("idx_usage_events_user_created").on(
      table.userId,
      table.createdAt.desc()
    ),
    index("idx_usage_events_user_tool").on(table.userId, table.toolName),
  ]
);

export const usageEventsDaily = pgTable(
  "usage_events_daily",
  {
    day: date("day").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    connector: text("connector"),
    calls: integer("calls").notNull(),
    errors: integer("errors").notNull(),
    p50Ms: integer("p50_ms").notNull(),
    p95Ms: integer("p95_ms").notNull(),
    totalBytes: integer("total_bytes").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.day, table.userId, table.toolName] }),
    index("idx_usage_daily_user_day").on(table.userId, table.day),
  ]
);
```

- [ ] **Step 2:** Add exports to `packages/db/src/schema/index.ts` (append the new lines)

```ts
export * from "./usage";
```

- [ ] **Step 3:** Generate migration

```bash
cd /Users/myang/git/datatorag-mcp
pnpm --filter @datatorag-mcp/db db:generate
```

Expected: new `packages/db/drizzle/NNNN_*.sql` file created. Inspect it to confirm both tables + indexes are correct.

- [ ] **Step 4:** Rebuild db package so gateway picks up types

```bash
pnpm --filter @datatorag-mcp/db build
```

- [ ] **Step 5:** Commit

```bash
git add packages/db/src/schema/usage.ts packages/db/src/schema/index.ts packages/db/drizzle/
git commit -m "Add usage_events and usage_events_daily tables"
```

---

## Phase 4 — Write path

### Task 7: Synchronous Postgres writer

**Files:**
- Create: `apps/gateway/src/gateway/usage/write.ts`
- Create: `apps/gateway/src/gateway/usage/write.test.ts`

- [ ] **Step 1:** Write test — verifies timeout behavior with a mocked insert

```ts
import { describe, it, expect, vi } from "vitest";
import { writeUsageEventWithTimeout } from "./write";

describe("writeUsageEventWithTimeout", () => {
  it("resolves ok when insert completes within timeout", async () => {
    const insert = vi.fn().mockResolvedValue(undefined);
    const result = await writeUsageEventWithTimeout(insert, 200);
    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledTimes(1);
  });

  it("resolves timeout=true if insert exceeds the budget", async () => {
    const insert = () => new Promise<void>((res) => setTimeout(res, 500));
    const result = await writeUsageEventWithTimeout(insert, 50);
    expect(result).toEqual({ ok: false, reason: "timeout" });
  });

  it("resolves error=true if insert throws", async () => {
    const insert = () => Promise.reject(new Error("boom"));
    const result = await writeUsageEventWithTimeout(insert, 200);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("error");
  });
});
```

- [ ] **Step 2:** Run, expect failures.

- [ ] **Step 3:** Implement `write.ts`

```ts
import type { Database } from "@datatorag-mcp/db";
import { usageEvents } from "@datatorag-mcp/db";
import { redactErrorMessage } from "./redact";
import type { OutcomeStatus } from "./classify";

export interface UsageEventInput {
  userId: string;
  toolName: string;
  connector: string | null;
  accountEmail: string | null;
  status: OutcomeStatus;
  latencyMs: number;
  responseSizeBytes: number | null;
  errorMessage: string | null;
}

export type WriteResult =
  | { ok: true }
  | { ok: false; reason: "timeout" | "error"; error?: Error };

export async function writeUsageEventWithTimeout(
  insert: () => Promise<void>,
  timeoutMs: number
): Promise<WriteResult> {
  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<WriteResult>((resolve) => {
    timeoutHandle = setTimeout(
      () => resolve({ ok: false, reason: "timeout" }),
      timeoutMs
    );
  });
  const workPromise = insert()
    .then<WriteResult>(() => ({ ok: true }))
    .catch<WriteResult>((err) => ({
      ok: false,
      reason: "error",
      error: err instanceof Error ? err : new Error(String(err)),
    }));
  const result = await Promise.race([workPromise, timeoutPromise]);
  if (timeoutHandle) clearTimeout(timeoutHandle);
  return result;
}

export async function writeUsageEvent(
  db: Database,
  input: UsageEventInput,
  timeoutMs = 200
): Promise<WriteResult> {
  return writeUsageEventWithTimeout(async () => {
    await db.insert(usageEvents).values({
      userId: input.userId,
      toolName: input.toolName,
      connector: input.connector,
      accountEmail: input.accountEmail,
      status: input.status,
      latencyMs: input.latencyMs,
      responseSizeBytes: input.responseSizeBytes,
      errorMessage: redactErrorMessage(input.errorMessage),
    });
  }, timeoutMs);
}
```

- [ ] **Step 4:** Run, expect 3 passing.

- [ ] **Step 5:** Commit

```bash
git add apps/gateway/src/gateway/usage/write.ts apps/gateway/src/gateway/usage/write.test.ts
git commit -m "Add synchronous usage_events writer with 200ms timeout"
```

---

### Task 8: Wire writer into `track.ts` and update `mcp-server.ts` call sites

**Files:**
- Modify: `apps/gateway/src/gateway/track.ts`
- Modify: `apps/gateway/src/gateway/mcp-server.ts`

- [ ] **Step 1:** Widen `trackToolCall` signature and add DB write in `track.ts`. Replace the current `trackToolCall` function with:

```ts
import type { Database } from "@datatorag-mcp/db";
import { writeUsageEvent } from "./usage/write.js";
import type { OutcomeStatus } from "./usage/classify.js";

export async function trackToolCall(
  db: Database,
  props: {
    userId: string;
    toolName: string;
    connectorType: string | null;
    accountEmail: string | undefined;
    status: OutcomeStatus;
    latencyMs: number;
    responseSizeBytes: number | null;
    errorMessage: string | null;
    meter: boolean;
  }
): Promise<void> {
  const c = getClient();
  if (c) {
    c.capture({
      distinctId: props.userId,
      event: EVENTS.TOOL_CALL,
      properties: {
        tool_name: props.toolName,
        connector_type: props.connectorType,
        account_email: props.accountEmail ?? null,
        status: props.status,
        latency_ms: props.latencyMs,
        response_size_bytes: props.responseSizeBytes,
        error_message: props.errorMessage,
        metered: props.meter,
      },
    });
  }

  if (!props.meter) return;

  const result = await writeUsageEvent(db, {
    userId: props.userId,
    toolName: props.toolName,
    connector: props.connectorType,
    accountEmail: props.accountEmail ?? null,
    status: props.status,
    latencyMs: props.latencyMs,
    responseSizeBytes: props.responseSizeBytes,
    errorMessage: props.errorMessage,
  });
  if (!result.ok) {
    console.warn(
      `[usage] write failed (${result.reason}) for user=${props.userId} tool=${props.toolName}`
    );
  }
}
```

Also add `import type { OutcomeStatus } from "./usage/classify.js";` at top.

- [ ] **Step 2:** Update both call sites in `apps/gateway/src/gateway/mcp-server.ts`.

Replace the first call site (success path, around line 323):

```ts
const responseText = JSON.stringify(result);
const isError = !!(result as { isError?: boolean }).isError;
const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
const errorMessage = isError
  ? content?.filter((c) => c.type === "text").map((c) => c.text).join(" ") ?? null
  : null;
const classification = classifyOutcome({
  thrown: false,
  isError,
  errorMessage,
  source: "mcp",
  toolName: name,
});
await trackToolCall(db, {
  userId,
  toolName: name,
  connectorType: requiredService ?? null,
  accountEmail,
  status: classification.status,
  latencyMs: Date.now() - startTime,
  responseSizeBytes: responseText.length,
  errorMessage,
  meter: classification.meter,
});
```

Replace the catch-block call site (around line 348):

```ts
const classification = classifyOutcome({
  thrown: true,
  errorMessage: message,
  source: "mcp",
  toolName: name,
});
await trackToolCall(db, {
  userId,
  toolName: name,
  connectorType: requiredService ?? null,
  accountEmail,
  status: classification.status,
  latencyMs: Date.now() - startTime,
  responseSizeBytes: null,
  errorMessage: message,
  meter: classification.meter,
});
```

Add import at top of `mcp-server.ts`:

```ts
import { classifyOutcome } from "./usage/classify.js";
```

Also verify `db` is in scope at the call sites — `createMcpServer(userId, db, pool)` already receives `db`, so pass it.

- [ ] **Step 3:** Run full test suite to ensure nothing broke

```bash
pnpm --filter gateway test
```

Expected: all existing tests (redact, classify, aggregate, rate-limit, write) pass.

- [ ] **Step 4:** Run the TypeScript check

```bash
pnpm --filter gateway exec tsc --noEmit
```

Expected: no errors in `track.ts`, `mcp-server.ts`, or `usage/`.

- [ ] **Step 5:** Commit

```bash
git add apps/gateway/src/gateway/track.ts apps/gateway/src/gateway/mcp-server.ts
git commit -m "Wire synchronous usage_events write into tool-call path"
```

---

## Phase 5 — Rate-limited API routes

### Task 9: `withRateLimit` helper

**Files:**
- Create: `apps/gateway/src/lib/with-rate-limit.ts`

- [ ] **Step 1:** Implement

```ts
import { NextResponse } from "next/server";
import { getSessionUserId } from "./session";
import { dashboardApiLimiter } from "@/gateway/usage/rate-limit";

export function withRateLimit(
  handler: (userId: string, req: Request) => Promise<Response>
) {
  return async (req: Request): Promise<Response> => {
    const userId = await getSessionUserId();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const check = dashboardApiLimiter.check(userId);
    if (!check.ok) {
      return NextResponse.json(
        { error: "Too many requests" },
        {
          status: 429,
          headers: {
            "Retry-After": String(Math.ceil(check.retryAfterMs / 1000)),
          },
        }
      );
    }
    return handler(userId, req);
  };
}
```

- [ ] **Step 2:** Commit

```bash
git add apps/gateway/src/lib/with-rate-limit.ts
git commit -m "Add withRateLimit helper for session-scoped API routes"
```

---

### Task 10: `/api/usage/summary`

**Files:**
- Create: `apps/gateway/src/app/api/usage/summary/route.ts`

- [ ] **Step 1:** Implement

```ts
import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";
import { withRateLimit } from "@/lib/with-rate-limit";

export const dynamic = "force-dynamic";

export const GET = withRateLimit(async (userId) => {
  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const rows = await db
    .select({
      total: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${usageEvents.status} = 'user_error')::int`,
      latencies: sql<number[]>`array_agg(${usageEvents.latencyMs})`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.createdAt, startOfMonth)
      )
    );

  const r = rows[0] ?? { total: 0, errors: 0, latencies: [] };
  const total = r.total ?? 0;
  const errors = r.errors ?? 0;
  const latencies = (r.latencies ?? []).filter((n) => typeof n === "number");
  const sorted = [...latencies].sort((a, b) => a - b);
  const p95 = sorted.length
    ? sorted[Math.min(sorted.length - 1, Math.floor(0.95 * sorted.length))]
    : 0;

  return NextResponse.json({
    totalCalls: total,
    successRate: total > 0 ? (total - errors) / total : 1,
    p95LatencyMs: p95,
    periodStart: startOfMonth.toISOString(),
  });
});
```

- [ ] **Step 2:** Commit

```bash
git add apps/gateway/src/app/api/usage/summary/route.ts
git commit -m "Add /api/usage/summary route"
```

---

### Task 11: `/api/usage/timeseries`

**Files:**
- Create: `apps/gateway/src/app/api/usage/timeseries/route.ts`

- [ ] **Step 1:** Implement — buckets in SQL using `date_trunc`

```ts
import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents, usageEventsDaily } from "@datatorag-mcp/db";
import { withRateLimit } from "@/lib/with-rate-limit";

export const dynamic = "force-dynamic";

const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;
type RangeKey = keyof typeof RANGES;

export const GET = withRateLimit(async (userId, req) => {
  const url = new URL(req.url);
  const rangeParam = (url.searchParams.get("range") ?? "7d") as RangeKey;
  const days = RANGES[rangeParam] ?? 7;
  const start = new Date(Date.now() - days * 24 * 3600_000);

  // Always use usage_events for <=90d ranges. Aggregate server-side.
  const bucket = days <= 1 ? "hour" : "day";

  const rows = await db
    .select({
      bucket: sql<string>`date_trunc(${bucket}, ${usageEvents.createdAt})::text`,
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${usageEvents.status} = 'user_error')::int`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.createdAt, start)
      )
    )
    .groupBy(sql`date_trunc(${bucket}, ${usageEvents.createdAt})`)
    .orderBy(sql`date_trunc(${bucket}, ${usageEvents.createdAt})`);

  return NextResponse.json({ range: rangeParam, bucket, points: rows });
});
```

- [ ] **Step 2:** Commit

```bash
git add apps/gateway/src/app/api/usage/timeseries/route.ts
git commit -m "Add /api/usage/timeseries with hour/day bucketing"
```

---

### Task 12: `/api/usage/by-tool`

**Files:**
- Create: `apps/gateway/src/app/api/usage/by-tool/route.ts`

- [ ] **Step 1:** Implement

```ts
import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";
import { withRateLimit } from "@/lib/with-rate-limit";

export const dynamic = "force-dynamic";

const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;

export const GET = withRateLimit(async (userId, req) => {
  const url = new URL(req.url);
  const rangeParam = (url.searchParams.get("range") ?? "7d") as keyof typeof RANGES;
  const days = RANGES[rangeParam] ?? 7;
  const start = new Date(Date.now() - days * 24 * 3600_000);

  const rows = await db
    .select({
      toolName: usageEvents.toolName,
      connector: usageEvents.connector,
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${usageEvents.status} = 'user_error')::int`,
      p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${usageEvents.latencyMs}), 0)::int`,
      p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageEvents.latencyMs}), 0)::int`,
      avgSize: sql<number>`coalesce(avg(${usageEvents.responseSizeBytes}), 0)::int`,
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.createdAt, start)
      )
    )
    .groupBy(usageEvents.toolName, usageEvents.connector)
    .orderBy(sql`count(*) desc`);

  return NextResponse.json({ range: rangeParam, tools: rows });
});
```

- [ ] **Step 2:** Commit

```bash
git add apps/gateway/src/app/api/usage/by-tool/route.ts
git commit -m "Add /api/usage/by-tool with p50/p95/avg per tool"
```

---

### Task 13: `/api/usage/by-connector` and `/api/usage/recent`

**Files:**
- Create: `apps/gateway/src/app/api/usage/by-connector/route.ts`
- Create: `apps/gateway/src/app/api/usage/recent/route.ts`

- [ ] **Step 1:** `by-connector/route.ts`

```ts
import { NextResponse } from "next/server";
import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";
import { withRateLimit } from "@/lib/with-rate-limit";

export const dynamic = "force-dynamic";
const RANGES = { "24h": 1, "7d": 7, "30d": 30, "90d": 90 } as const;

export const GET = withRateLimit(async (userId, req) => {
  const url = new URL(req.url);
  const range = (url.searchParams.get("range") ?? "7d") as keyof typeof RANGES;
  const days = RANGES[range] ?? 7;
  const start = new Date(Date.now() - days * 24 * 3600_000);
  const bucket = days <= 1 ? "hour" : "day";

  const rows = await db
    .select({
      bucket: sql<string>`date_trunc(${bucket}, ${usageEvents.createdAt})::text`,
      connector: usageEvents.connector,
      calls: sql<number>`count(*)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.createdAt, start)))
    .groupBy(sql`date_trunc(${bucket}, ${usageEvents.createdAt})`, usageEvents.connector)
    .orderBy(sql`date_trunc(${bucket}, ${usageEvents.createdAt})`);

  return NextResponse.json({ range, bucket, points: rows });
});
```

- [ ] **Step 2:** `recent/route.ts`

```ts
import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";
import { withRateLimit } from "@/lib/with-rate-limit";

export const dynamic = "force-dynamic";

export const GET = withRateLimit(async (userId) => {
  const rows = await db
    .select({
      id: usageEvents.id,
      toolName: usageEvents.toolName,
      connector: usageEvents.connector,
      status: usageEvents.status,
      latencyMs: usageEvents.latencyMs,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(eq(usageEvents.userId, userId))
    .orderBy(desc(usageEvents.createdAt))
    .limit(50);

  return NextResponse.json({ events: rows });
});
```

- [ ] **Step 3:** Commit

```bash
git add apps/gateway/src/app/api/usage/
git commit -m "Add /api/usage/by-connector and /api/usage/recent"
```

---

## Phase 6 — Dashboard UI

### Task 14: Install recharts + scaffold `/dashboard/usage`

**Files:**
- Modify: `apps/gateway/package.json` (add recharts)
- Create: `apps/gateway/src/app/dashboard/usage/page.tsx`
- Create: `apps/gateway/src/app/dashboard/usage/usage-client.tsx`
- Modify: `apps/gateway/src/app/dashboard/layout.tsx`

- [ ] **Step 1:** Install

```bash
pnpm --filter gateway add recharts
```

- [ ] **Step 2:** Add Usage nav item. In `apps/gateway/src/app/dashboard/layout.tsx`, replace the `navItems` array:

```ts
const navItems = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/usage", label: "Usage" },
  { href: "/docs", label: "Docs" },
];
```

- [ ] **Step 3:** Create `page.tsx` (server component)

```tsx
import { redirect } from "next/navigation";
import { getSessionUserId } from "@/lib/session";
import { UsageClient } from "./usage-client";

export const dynamic = "force-dynamic";

export default async function UsagePage() {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  return <UsageClient />;
}
```

- [ ] **Step 4:** Create `usage-client.tsx` skeleton — empty sections as placeholders

```tsx
"use client";

import { useState, useEffect } from "react";

type Range = "24h" | "7d" | "30d" | "90d";

export function UsageClient() {
  const [range, setRange] = useState<Range>("7d");
  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-foreground">Usage</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Tool calls, latency, and error rate across your MCP activity.
      </p>

      <RangeToggle value={range} onChange={setRange} />
      <SummaryCards range={range} />
      <TimeseriesChart range={range} />
      <ToolBreakdown range={range} />
      <ToolsTable range={range} />
      <RecentActivity />
    </div>
  );
}

function RangeToggle({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const options: Range[] = ["24h", "7d", "30d", "90d"];
  return (
    <div className="mt-6 inline-flex rounded-lg border border-border p-0.5">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
            value === opt
              ? "bg-secondary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function SummaryCards({ range }: { range: Range }) {
  const [data, setData] = useState<{ totalCalls: number; successRate: number; p95LatencyMs: number } | null>(null);
  useEffect(() => {
    fetch("/api/usage/summary").then((r) => r.ok && r.json()).then(setData);
  }, [range]);
  if (!data) return <div className="mt-6 text-sm text-muted-foreground">Loading…</div>;
  return (
    <div className="mt-6 grid gap-4 sm:grid-cols-3">
      <Card label="Total calls (MTD)" value={data.totalCalls.toLocaleString()} />
      <Card label="Success rate" value={`${(data.successRate * 100).toFixed(1)}%`} />
      <Card label="p95 latency" value={`${data.p95LatencyMs} ms`} />
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-2xl font-bold text-foreground">{value}</p>
    </div>
  );
}

function TimeseriesChart({ range }: { range: Range }) {
  return <section className="mt-10 text-sm text-muted-foreground">Timeseries chart — Task 15</section>;
}
function ToolBreakdown({ range }: { range: Range }) {
  return <section className="mt-10 text-sm text-muted-foreground">Top tools + by-connector — Task 16</section>;
}
function ToolsTable({ range }: { range: Range }) {
  return <section className="mt-10 text-sm text-muted-foreground">Tools table — Task 17</section>;
}
function RecentActivity() {
  return <section className="mt-10 text-sm text-muted-foreground">Activity feed — Task 18</section>;
}
```

- [ ] **Step 5:** Commit

```bash
git add apps/gateway/src/app/dashboard/usage/ apps/gateway/src/app/dashboard/layout.tsx apps/gateway/package.json pnpm-lock.yaml
git commit -m "Scaffold /dashboard/usage page with summary cards + nav link"
```

---

### Task 15: Timeseries line chart

**Files:**
- Modify: `apps/gateway/src/app/dashboard/usage/usage-client.tsx`

- [ ] **Step 1:** Replace the `TimeseriesChart` stub with a recharts line chart

```tsx
import { LineChart, Line, CartesianGrid, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

function TimeseriesChart({ range }: { range: Range }) {
  const [data, setData] = useState<{ bucket: string; calls: number; errors: number }[]>([]);
  useEffect(() => {
    fetch(`/api/usage/timeseries?range=${range}`)
      .then((r) => (r.ok ? r.json() : { points: [] }))
      .then((j) => setData(j.points ?? []));
  }, [range]);

  return (
    <section className="mt-10 rounded-xl border border-border p-5">
      <h2 className="font-display text-base font-bold text-foreground">Call volume</h2>
      <div className="mt-4 h-64">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
            <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
            <Tooltip />
            <Line type="monotone" dataKey="calls" stroke="hsl(var(--primary))" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
```

- [ ] **Step 2:** Commit

```bash
git add apps/gateway/src/app/dashboard/usage/usage-client.tsx
git commit -m "Add call-volume line chart to usage dashboard"
```

---

### Task 16: Top tools bar + by-connector stacked bar

**Files:**
- Modify: `apps/gateway/src/app/dashboard/usage/usage-client.tsx`

- [ ] **Step 1:** Replace `ToolBreakdown` stub

```tsx
import { BarChart, Bar, Legend } from "recharts";

function ToolBreakdown({ range }: { range: Range }) {
  const [tools, setTools] = useState<{ toolName: string; calls: number }[]>([]);
  const [byConnector, setByConnector] = useState<Array<{ bucket: string; [connector: string]: number | string }>>([]);

  useEffect(() => {
    fetch(`/api/usage/by-tool?range=${range}`)
      .then((r) => (r.ok ? r.json() : { tools: [] }))
      .then((j) => setTools((j.tools ?? []).slice(0, 10)));
    fetch(`/api/usage/by-connector?range=${range}`)
      .then((r) => (r.ok ? r.json() : { points: [] }))
      .then((j) => {
        // pivot points into bucket-indexed rows
        const byBucket = new Map<string, Record<string, number | string>>();
        for (const p of j.points ?? []) {
          const row = byBucket.get(p.bucket) ?? { bucket: p.bucket };
          row[p.connector ?? "unknown"] = p.calls;
          byBucket.set(p.bucket, row);
        }
        setByConnector(Array.from(byBucket.values()));
      });
  }, [range]);

  const connectors = Array.from(
    new Set(byConnector.flatMap((r) => Object.keys(r).filter((k) => k !== "bucket")))
  );

  return (
    <section className="mt-10 grid gap-5 lg:grid-cols-2">
      <div className="rounded-xl border border-border p-5">
        <h2 className="font-display text-base font-bold text-foreground">Top 10 tools</h2>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tools} layout="vertical">
              <XAxis type="number" tick={{ fontSize: 11 }} />
              <YAxis dataKey="toolName" type="category" tick={{ fontSize: 11 }} width={140} />
              <Tooltip />
              <Bar dataKey="calls" fill="hsl(var(--primary))" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="rounded-xl border border-border p-5">
        <h2 className="font-display text-base font-bold text-foreground">By connector</h2>
        <div className="mt-4 h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byConnector}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {connectors.map((c, i) => (
                <Bar key={c} dataKey={c} stackId="a" fill={`hsl(${(i * 137) % 360}, 65%, 55%)`} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2:** Commit

```bash
git add apps/gateway/src/app/dashboard/usage/usage-client.tsx
git commit -m "Add top-tools and by-connector charts to usage dashboard"
```

---

### Task 17: Sortable tools table + drill-down route

**Files:**
- Modify: `apps/gateway/src/app/dashboard/usage/usage-client.tsx`
- Create: `apps/gateway/src/app/dashboard/usage/[tool]/page.tsx`

- [ ] **Step 1:** Replace `ToolsTable` with a sortable table that links rows to `/dashboard/usage/[tool]`

```tsx
import Link from "next/link";

function ToolsTable({ range }: { range: Range }) {
  const [rows, setRows] = useState<Array<{
    toolName: string; connector: string | null; calls: number; errors: number; p50: number; p95: number; avgSize: number;
  }>>([]);
  const [sort, setSort] = useState<"calls" | "errors" | "p95">("calls");

  useEffect(() => {
    fetch(`/api/usage/by-tool?range=${range}`)
      .then((r) => (r.ok ? r.json() : { tools: [] }))
      .then((j) => setRows(j.tools ?? []));
  }, [range]);

  const sorted = [...rows].sort((a, b) => (b[sort] as number) - (a[sort] as number));

  return (
    <section className="mt-10">
      <h2 className="font-display text-base font-bold text-foreground">All tools</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">Tool</th>
              <th className="px-4 py-2 text-left">Connector</th>
              <th onClick={() => setSort("calls")} className="cursor-pointer px-4 py-2 text-right">Calls</th>
              <th className="px-4 py-2 text-right">Success %</th>
              <th className="px-4 py-2 text-right">p50</th>
              <th onClick={() => setSort("p95")} className="cursor-pointer px-4 py-2 text-right">p95</th>
              <th className="px-4 py-2 text-right">Avg size</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.toolName} className="border-t border-border hover:bg-secondary/30">
                <td className="px-4 py-2 font-mono text-xs">
                  <Link href={`/dashboard/usage/${r.toolName}`} className="text-foreground hover:text-primary">
                    {r.toolName}
                  </Link>
                </td>
                <td className="px-4 py-2 text-muted-foreground">{r.connector ?? "—"}</td>
                <td className="px-4 py-2 text-right">{r.calls.toLocaleString()}</td>
                <td className="px-4 py-2 text-right">{r.calls > 0 ? `${(((r.calls - r.errors) / r.calls) * 100).toFixed(1)}%` : "—"}</td>
                <td className="px-4 py-2 text-right">{r.p50} ms</td>
                <td className="px-4 py-2 text-right">{r.p95} ms</td>
                <td className="px-4 py-2 text-right">{Math.round(r.avgSize).toLocaleString()} B</td>
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-muted-foreground">No tool calls in this range yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
```

- [ ] **Step 2:** Create `[tool]/page.tsx` drill-down — fetches latency histogram + recent calls for one tool

```tsx
import Link from "next/link";
import { redirect } from "next/navigation";
import { and, desc, eq, sql } from "drizzle-orm";
import { getSessionUserId } from "@/lib/session";
import { db } from "@/lib/db";
import { usageEvents } from "@datatorag-mcp/db";

export const dynamic = "force-dynamic";

export default async function ToolDetailPage({
  params,
}: {
  params: Promise<{ tool: string }>;
}) {
  const userId = await getSessionUserId();
  if (!userId) redirect("/auth/login");
  const { tool } = await params;

  const recent = await db
    .select({
      id: usageEvents.id,
      status: usageEvents.status,
      latencyMs: usageEvents.latencyMs,
      errorMessage: usageEvents.errorMessage,
      createdAt: usageEvents.createdAt,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), eq(usageEvents.toolName, tool)))
    .orderBy(desc(usageEvents.createdAt))
    .limit(50);

  const [agg] = await db
    .select({
      calls: sql<number>`count(*)::int`,
      errors: sql<number>`count(*) filter (where ${usageEvents.status} = 'user_error')::int`,
      p50: sql<number>`coalesce(percentile_cont(0.5) within group (order by ${usageEvents.latencyMs}), 0)::int`,
      p95: sql<number>`coalesce(percentile_cont(0.95) within group (order by ${usageEvents.latencyMs}), 0)::int`,
    })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), eq(usageEvents.toolName, tool)));

  return (
    <div>
      <Link href="/dashboard/usage" className="text-sm text-muted-foreground hover:text-foreground">
        &larr; Usage
      </Link>
      <h1 className="mt-4 font-mono text-2xl font-bold text-foreground">{tool}</h1>

      <div className="mt-6 grid gap-4 sm:grid-cols-4">
        <Card label="Total calls" value={agg?.calls.toLocaleString() ?? "0"} />
        <Card label="User errors" value={agg?.errors.toLocaleString() ?? "0"} />
        <Card label="p50" value={`${agg?.p50 ?? 0} ms`} />
        <Card label="p95" value={`${agg?.p95 ?? 0} ms`} />
      </div>

      <h2 className="mt-10 font-display text-base font-bold text-foreground">Recent calls</h2>
      <div className="mt-3 overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2 text-left">When</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-right">Latency</th>
              <th className="px-4 py-2 text-left">Error</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((r) => (
              <tr key={r.id} className="border-t border-border">
                <td className="px-4 py-2 text-xs text-muted-foreground">{new Date(r.createdAt).toLocaleString()}</td>
                <td className="px-4 py-2 text-xs">{r.status}</td>
                <td className="px-4 py-2 text-right text-xs">{r.latencyMs} ms</td>
                <td className="px-4 py-2 text-xs text-muted-foreground">{r.errorMessage ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border p-5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 font-display text-xl font-bold text-foreground">{value}</p>
    </div>
  );
}
```

- [ ] **Step 3:** Commit

```bash
git add apps/gateway/src/app/dashboard/usage/
git commit -m "Add sortable tools table + per-tool drill-down page"
```

---

### Task 18: Recent activity feed

**Files:**
- Modify: `apps/gateway/src/app/dashboard/usage/usage-client.tsx`

- [ ] **Step 1:** Replace `RecentActivity` stub

```tsx
function RecentActivity() {
  const [events, setEvents] = useState<Array<{
    id: string; toolName: string; connector: string | null; status: string; latencyMs: number; createdAt: string;
  }>>([]);
  useEffect(() => {
    fetch("/api/usage/recent")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j) => setEvents(j.events ?? []));
  }, []);

  return (
    <section className="mt-10">
      <h2 className="font-display text-base font-bold text-foreground">Recent activity</h2>
      <ul className="mt-3 divide-y divide-border rounded-xl border border-border">
        {events.map((e) => (
          <li key={e.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
            <div className="flex items-center gap-3 min-w-0">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${e.status === "success" ? "bg-emerald-500" : "bg-amber-500"}`} />
              <span className="font-mono text-xs text-foreground truncate">{e.toolName}</span>
              <span className="text-xs text-muted-foreground">{e.connector ?? ""}</span>
            </div>
            <div className="flex shrink-0 items-center gap-3 text-xs text-muted-foreground">
              <span>{e.latencyMs} ms</span>
              <time>{new Date(e.createdAt).toLocaleTimeString()}</time>
            </div>
          </li>
        ))}
        {events.length === 0 && (
          <li className="px-4 py-6 text-center text-sm text-muted-foreground">No recent activity.</li>
        )}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2:** Commit

```bash
git add apps/gateway/src/app/dashboard/usage/usage-client.tsx
git commit -m "Add recent activity feed to usage dashboard"
```

---

## Phase 7 — Retention + rollup

### Task 19: Daily rollup job (node-cron)

**Decision note:** Spec requested `pg_cron`. The project's Postgres 16 image does not include pg_cron and enabling it requires changing `shared_preload_libraries` (Postgres restart + a custom Docker image). To keep infra churn minimal, this plan uses **node-cron** in the gateway process. The rollup SQL itself is identical either way; moving to pg_cron later is a one-file swap. Flag this to Manuel at review.

**Files:**
- Create: `apps/gateway/src/gateway/usage/rollup.ts`
- Create: `apps/gateway/src/gateway/usage/rollup.test.ts`
- Modify: `apps/gateway/server.ts`
- Modify: `apps/gateway/package.json` (add `node-cron`)

- [ ] **Step 1:** Install node-cron

```bash
pnpm --filter gateway add node-cron
pnpm --filter gateway add -D @types/node-cron
```

- [ ] **Step 2:** Write `rollup.test.ts` — at minimum, a test that the SQL statements are well-formed (we'll exercise the real DB in E2E)

```ts
import { describe, it, expect } from "vitest";
import { buildRollupSql, buildPruneSql } from "./rollup";

describe("buildRollupSql", () => {
  it("inserts grouped rows for the target day", () => {
    const sql = buildRollupSql("2026-04-20");
    expect(sql).toContain("INSERT INTO usage_events_daily");
    expect(sql).toContain("2026-04-20");
    expect(sql).toContain("percentile_cont(0.5)");
    expect(sql).toContain("percentile_cont(0.95)");
    expect(sql).toContain("ON CONFLICT");
  });
});

describe("buildPruneSql", () => {
  it("deletes rows older than 90 days", () => {
    const sql = buildPruneSql();
    expect(sql).toMatch(/DELETE FROM usage_events/i);
    expect(sql).toContain("90 days");
  });
});
```

- [ ] **Step 3:** Implement `rollup.ts`

```ts
import type { Database } from "@datatorag-mcp/db";
import { sql } from "drizzle-orm";

export function buildRollupSql(day: string): string {
  return `
    INSERT INTO usage_events_daily (day, user_id, tool_name, connector, calls, errors, p50_ms, p95_ms, total_bytes)
    SELECT
      DATE '${day}' AS day,
      user_id,
      tool_name,
      connector,
      count(*)::int AS calls,
      count(*) filter (where status = 'user_error')::int AS errors,
      percentile_cont(0.5) within group (order by latency_ms)::int AS p50_ms,
      percentile_cont(0.95) within group (order by latency_ms)::int AS p95_ms,
      coalesce(sum(response_size_bytes), 0)::int AS total_bytes
    FROM usage_events
    WHERE created_at >= DATE '${day}'
      AND created_at <  DATE '${day}' + INTERVAL '1 day'
    GROUP BY user_id, tool_name, connector
    ON CONFLICT (day, user_id, tool_name) DO UPDATE SET
      connector = EXCLUDED.connector,
      calls = EXCLUDED.calls,
      errors = EXCLUDED.errors,
      p50_ms = EXCLUDED.p50_ms,
      p95_ms = EXCLUDED.p95_ms,
      total_bytes = EXCLUDED.total_bytes;
  `.trim();
}

export function buildPruneSql(): string {
  return "DELETE FROM usage_events WHERE created_at < now() - INTERVAL '90 days';";
}

export async function runDailyRollup(db: Database, now: Date = new Date()): Promise<void> {
  const yesterday = new Date(now.getTime() - 24 * 3600_000);
  const day = yesterday.toISOString().slice(0, 10);
  console.log(`[rollup] aggregating ${day}`);
  await db.execute(sql.raw(buildRollupSql(day)));
  console.log(`[rollup] pruning events older than 90 days`);
  await db.execute(sql.raw(buildPruneSql()));
  console.log(`[rollup] done`);
}
```

- [ ] **Step 4:** Wire cron into `server.ts`. After the existing `shutdown` handler:

```ts
import cron from "node-cron";
import { runDailyRollup } from "./src/gateway/usage/rollup.js";

// inside main(), after db is created:
const rollupJob = cron.schedule("0 2 * * *", () => {
  runDailyRollup(db).catch((err) => console.error("[rollup] failed", err));
}, { timezone: "UTC" });
```

Add `rollupJob.stop();` inside the `shutdown` callback before `process.exit(0);`.

- [ ] **Step 5:** Run tests, commit

```bash
pnpm --filter gateway test
git add apps/gateway/src/gateway/usage/rollup.ts apps/gateway/src/gateway/usage/rollup.test.ts apps/gateway/server.ts apps/gateway/package.json pnpm-lock.yaml
git commit -m "Add daily usage rollup + 90-day prune (node-cron @ 02:00 UTC)"
```

---

## Phase 8 — Verification

### Task 20: E2E smoke test

Manual run-through against the acceptance criteria:

- [ ] **Step 1:** Start gateway locally (requires Postgres). Use hosted DB or local docker-compose.

```bash
docker compose -f docker/docker-compose.dev.yml up -d
pnpm --filter @datatorag-mcp/db db:push
pnpm --filter gateway dev
```

- [ ] **Step 2:** Make a real tool call via an MCP client to a connected GWS account. Within 1s, confirm row exists:

```bash
psql "$DATABASE_URL" -c "SELECT tool_name, status, latency_ms, created_at FROM usage_events ORDER BY created_at DESC LIMIT 5;"
```

Expected: the call you just made is at the top.

- [ ] **Step 3:** Open `http://localhost:8285/dashboard/usage`. Confirm:
  - Summary cards show non-zero values
  - Call volume line chart has a point
  - Top tools bar shows the tool you called
  - Sortable table has the row; clicking navigates to `/dashboard/usage/<tool>`
  - Recent activity feed shows the entry

- [ ] **Step 4:** Backdate rows and test 30d / 90d ranges

```bash
psql "$DATABASE_URL" -c "UPDATE usage_events SET created_at = now() - interval '60 days' WHERE id = (SELECT id FROM usage_events ORDER BY created_at ASC LIMIT 1);"
```

Switch the dashboard to 90d range; confirm the backdated row appears.

- [ ] **Step 5:** Trigger a user_error (e.g., call `gmail_read` with a bad message_id). Confirm it appears with `status=user_error` and counts toward totals.

- [ ] **Step 6:** Trigger a server_error by killing the gws-mcp plugin process mid-call, then call a tool. Confirm **no row** is inserted for the thrown error.

- [ ] **Step 7:** Rate-limit test — spam 130 requests in one minute:

```bash
for i in {1..130}; do curl -s -o /dev/null -w "%{http_code}\n" --cookie "dtrmcp_session=<your session>" http://localhost:8285/api/usage/summary; done | sort | uniq -c
```

Expected: ~120 × `200`, ~10 × `429` with `Retry-After` header.

- [ ] **Step 8:** Run rollup manually to exercise the SQL

```bash
psql "$DATABASE_URL" -c "$(node -e 'import("./apps/gateway/src/gateway/usage/rollup.js").then(m => console.log(m.buildRollupSql(new Date(Date.now() - 86400000).toISOString().slice(0,10))))')"
psql "$DATABASE_URL" -c "SELECT * FROM usage_events_daily LIMIT 5;"
```

Expected: rows exist for yesterday.

- [ ] **Step 9:** When all criteria pass, ping Manuel with a summary.

---

## Self-review summary

- **Spec coverage:** schema ✓, write path ✓, PII redaction ✓, metering rules ✓, retention ✓, dashboard sections ✓, rate limit ✓, nav ✓, API routes ✓, query auto-switch (partially — <90d always goes to raw table; >90d drills would use daily but the dashboard toggle caps at 90d so this is latent until ranges expand).
- **Deferred by spec:** Stripe, tiers, quota middleware, spend caps — out of scope, not planned.
- **Deviation:** `pg_cron` swapped for `node-cron` — called out in Task 19. All rollup SQL is identical; swapping later is ~10 lines.
- **Not fully tested in isolation:** the UI components (charts, table). Acceptance relies on manual E2E. Acceptable for dashboard code.
- **Placeholder scan:** no TBDs or vague steps. Every code block is runnable.
- **Type consistency:** `OutcomeStatus = "success" | "user_error" | "server_error"` used consistently across `classify.ts`, `write.ts`, `track.ts`, schema status column values.
