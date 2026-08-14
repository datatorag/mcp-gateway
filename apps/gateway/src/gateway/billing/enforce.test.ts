import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { eq, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";
import { getTestDb, stopTestDb, insertTestUser, isDockerAvailable } from "@/test-utils/db";
import { FREE_MONTHLY_CAP, PRO_MONTHLY_INCLUDED } from "./plans";

// Internal exemption is an env-derived email heuristic; pin it to a test
// domain so the suite doesn't depend on process env.
vi.mock("../../lib/brevo", () => ({
  isInternalEmail: (email: string) => email.endsWith("@internal.test"),
}));

import { checkCallAllowance } from "./enforce";

// REAL POSTGRES: `callsRemaining` is a roll-and-read CTE and the property
// under test is "a user AT the cap is refused" — the acceptance test for a
// gate is attempting the forbidden thing and watching it fail, against the
// real statement, not a stub that would allow anything.
const dockerAvailable = isDockerAvailable();

let db: Database;

async function setUsage(userId: string, plan: string, calls: number): Promise<void> {
  await db
    .update(users)
    .set({ plan: plan as "free" | "pro", currentPeriodCalls: calls })
    .where(eq(users.id, userId));
}

describe.skipIf(!dockerAvailable)("call allowance enforcement (real db)", () => {
  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);
  afterAll(async () => {
    await stopTestDb();
  });

  it("REFUSES a free user at the cap — the forbidden call does not pass", async () => {
    const userId = await insertTestUser(db);
    await setUsage(userId, "free", FREE_MONTHLY_CAP);
    const check = await checkCallAllowance(db, userId);
    expect(check.allowed).toBe(false);
    if (!check.allowed) {
      expect(check.message).toContain(String(FREE_MONTHLY_CAP));
    }
  });

  it("allows the free user's last call before the cap", async () => {
    const userId = await insertTestUser(db);
    await setUsage(userId, "free", FREE_MONTHLY_CAP - 1);
    expect(await checkCallAllowance(db, userId)).toEqual({ allowed: true });
  });

  it("never refuses Pro — no hard stop, and no metered billing yet either", async () => {
    const userId = await insertTestUser(db);
    await setUsage(userId, "pro", PRO_MONTHLY_INCLUDED + 5000);
    expect(await checkCallAllowance(db, userId)).toEqual({ allowed: true });
  });

  it("exempts internal accounts even at the cap", async () => {
    const userId = await insertTestUser(db);
    await db
      .update(users)
      .set({ email: `founder-${userId.slice(0, 8)}@internal.test` })
      .where(eq(users.id, userId));
    await setUsage(userId, "free", FREE_MONTHLY_CAP + 100);
    expect(await checkCallAllowance(db, userId)).toEqual({ allowed: true });
  });

  it("a lapsed period rolls before the check, so a returning user is not refused on stale usage", async () => {
    const userId = await insertTestUser(db);
    await setUsage(userId, "free", FREE_MONTHLY_CAP);
    await db
      .update(users)
      .set({ currentPeriodStart: sql`now() - interval '2 months'` })
      .where(eq(users.id, userId));
    expect(await checkCallAllowance(db, userId)).toEqual({ allowed: true });
  });
});
