/**
 * billingUsage (SCRUM-352) against a real Postgres: the Billing page reads the
 * same row and the same interval enforcement uses, so month arithmetic is
 * Postgres's, not ours, and that is what these pin.
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "../../test-utils/db";

const internal = vi.hoisted(() => ({ value: false }));
vi.mock("../../lib/brevo", () => ({ isInternalEmail: () => internal.value }));

const { billingUsage } = await import("./period");
const { planLimits } = await import("../billing/plans");

const dockerAvailable = isDockerAvailable();

describe.skipIf(!dockerAvailable)("billingUsage (SCRUM-352)", () => {
  let db: Database;
  let userId: string;

  beforeAll(async () => {
    db = await getTestDb();
    userId = await insertTestUser(db);
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  async function set(plan: string, calls: number, runs: number, start: string) {
    await db.execute(sql`
      UPDATE users SET plan = ${plan}, current_period_calls = ${calls},
        current_period_agent_runs = ${runs}, current_period_start = ${start}::timestamptz
      WHERE id = ${userId}
    `);
  }

  it("reads the counters enforcement reads, with the plan's allowances and a reset one month on", async () => {
    internal.value = false;
    const start = new Date(Date.now() - 3 * 86_400_000).toISOString();
    await set("free", 40, 3, start);
    const u = await billingUsage(db, userId);
    expect(u).toMatchObject({
      plan: "free",
      calls: 40,
      callsIncluded: planLimits("free").monthlyIncluded,
      agentRuns: 3,
      agentRunCap: planLimits("free").agentRuns,
      lapsed: false,
      hardCap: true,
    });
    const [{ expected }] = await db.execute<{ expected: Date }>(
      sql`SELECT ${start}::timestamptz + interval '1 month' AS expected`
    );
    expect(u!.resetsAt!.getTime()).toBe(new Date(expected).getTime());
  });

  it("uses Postgres month arithmetic: a Jan 31 start resets when the roll would", async () => {
    // Pinned to the SQL the roll uses, not to a calendar opinion: whatever
    // Postgres says Jan 31 plus a month is, the page must say the same.
    const [{ roll }] = await db.execute<{ roll: Date }>(
      sql`SELECT '2027-01-31T10:00:00Z'::timestamptz + interval '1 month' AS roll`
    );
    // A start in the future is never lapsed, so the date is reported.
    await set("pro", 5, 1, "2027-01-31T10:00:00Z");
    const u = await billingUsage(db, userId);
    expect(u!.resetsAt!.getTime()).toBe(new Date(roll).getTime());
    expect(u!.hardCap).toBe(false);
  });

  it("a lapsed period reads as zero with no date, and nothing is written", async () => {
    await set("pro", 1_900, 80, new Date(Date.now() - 40 * 86_400_000).toISOString());
    const u = await billingUsage(db, userId);
    expect(u).toMatchObject({ calls: 0, agentRuns: 0, resetsAt: null, lapsed: true });
    const [row] = await db.execute<{ calls: number }>(
      sql`SELECT current_period_calls AS calls FROM users WHERE id = ${userId}`
    );
    expect(Number(row.calls)).toBe(1_900);
  });

  it("an exempt internal account is counted but not capped", async () => {
    internal.value = true;
    await set("free", 400, 30, new Date().toISOString());
    const u = await billingUsage(db, userId);
    expect(u).toMatchObject({ calls: 400, callsIncluded: null, agentRuns: 30, agentRunCap: null });
    internal.value = false;
  });

  it("no row, no usage", async () => {
    expect(await billingUsage(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });
});
