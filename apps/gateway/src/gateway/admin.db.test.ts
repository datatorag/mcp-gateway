/**
 * `isAdmin` against a real Postgres (SCRUM-302), including that a fresh
 * database has the column at all: the read is an authorization decision, so
 * "the migration ran" is part of the claim, not a separate concern.
 *
 * Gated on a Docker daemon the way the other db suites are; skipped, not
 * failed, where there is none.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "../test-utils/db";
import { isAdmin } from "./admin";
import { checkCallAllowance } from "./billing/enforce";
import { FREE_MONTHLY_CAP } from "./billing/plans";

const dockerAvailable = isDockerAvailable();

describe.skipIf(!dockerAvailable)("users.role against a fresh database (SCRUM-302)", () => {
  let db: Database;

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  it("migration 0018 added the column, not null, defaulting to user", async () => {
    const cols = await db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'role'
    `);
    expect(cols).toHaveLength(1);
    expect(cols[0].data_type).toBe("text");
    expect(cols[0].is_nullable).toBe("NO");
    expect(String(cols[0].column_default)).toContain("'user'");
  });

  it("a new row is a user by default, so the migration grants nobody anything", async () => {
    const userId = await insertTestUser(db);
    const [row] = await db.execute<{ role: string }>(
      sql`SELECT role FROM users WHERE id = ${userId}`
    );
    expect(row.role).toBe("user");
    expect(await isAdmin(db, userId)).toBe(false);
  });

  it("is true for exactly 'admin'", async () => {
    const userId = await insertTestUser(db);
    await db.execute(sql`UPDATE users SET role = 'admin' WHERE id = ${userId}`);
    expect(await isAdmin(db, userId)).toBe(true);
  });

  it.each([
    ["Admin", "a different case is a different string, and the read is exact"],
    ["administrator", "a longer value that merely starts the same"],
    ["superuser", "a value from some future build this one has never heard of"],
    ["", "an empty string"],
    ["admin ", "a trailing space, the shape a hand-edited row arrives in"],
  ])("is false for %j (%s)", async (value) => {
    const userId = await insertTestUser(db);
    await db.execute(sql`UPDATE users SET role = ${value} WHERE id = ${userId}`);
    expect(await isAdmin(db, userId)).toBe(false);
  });

  it("is false for a user id with no row, rather than throwing", async () => {
    expect(await isAdmin(db, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });

  /**
   * The role grants the admin SURFACES and nothing else.
   *
   * No code change was needed for this and that is exactly why it is pinned.
   * The cap exemption reads the email domain (`capExempt`), whose own doc
   * comment says at length that it must never become an authorization check.
   * The converse matters just as much: an authorization column must not
   * quietly start exempting people from limits. Today's admins are exempt
   * because of their address, never because of their role, and this fails the
   * day someone wires `role` into the allowance path.
   */
  it("role admin does not lift the call cap for an outside address", async () => {
    const userId = await insertTestUser(db);
    await db.execute(sql`
      UPDATE users
      SET role = 'admin',
          plan = 'free',
          current_period_calls = ${FREE_MONTHLY_CAP + 1},
          current_period_start = now()
      WHERE id = ${userId}
    `);
    expect(await isAdmin(db, userId)).toBe(true);

    const check = await checkCallAllowance(db, userId);
    expect(check.allowed).toBe(false);
  });

  it("and the same account under the cap is allowed, so the case above is not vacuous", async () => {
    const userId = await insertTestUser(db);
    await db.execute(sql`
      UPDATE users
      SET role = 'admin', plan = 'free', current_period_calls = 0, current_period_start = now()
      WHERE id = ${userId}
    `);
    expect((await checkCallAllowance(db, userId)).allowed).toBe(true);
  });
});
