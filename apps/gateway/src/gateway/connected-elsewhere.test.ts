/**
 * SCRUM-363: is the account being connected already held by another
 * DataToRAG user?
 *
 * Real Postgres, because the match is the unique key's: connector, email,
 * and the external id compared NULLS NOT DISTINCT.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { connectedAccounts, serviceConnections, users, type Database } from "@datatorag-mcp/db";
import { eq } from "drizzle-orm";
import { getTestDb, stopTestDb, isDockerAvailable } from "../test-utils/db";
import { connectedElsewhere, maskEmail } from "./connected-accounts";

describe("maskEmail", () => {
  it("keeps the first character of the local part and the domain", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j•••@example.com");
    expect(maskEmail("j@example.com")).toBe("j•••@example.com");
  });

  it("never returns the address unmasked, even when it is not one", () => {
    expect(maskEmail("not-an-address")).toBe("•••");
    expect(maskEmail("@example.com")).toBe("•••");
  });
});

describe.skipIf(!isDockerAvailable())("connectedElsewhere", () => {
  let db: Database;

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  async function user(email: string): Promise<string> {
    const id = randomUUID();
    await db.insert(users).values({ id, email, emailVerified: true });
    return id;
  }

  async function connect(
    userId: string,
    connectorType: string,
    accountEmail: string,
    externalAccountId: string | null = null,
    connectedAt = new Date()
  ) {
    const sc = randomUUID();
    await db.insert(serviceConnections).values({ id: sc, userId, service: connectorType, accessToken: "x" });
    await db.insert(connectedAccounts).values({
      userId,
      connectorType,
      accountEmail,
      externalAccountId,
      serviceConnectionId: sc,
      createdAt: connectedAt,
    });
  }

  const tag = () => randomUUID().slice(0, 8);

  it("names the other user, masked, when only they hold the account", async () => {
    const t = tag();
    const other = await user(`personal-${t}@example.com`);
    const me = await user(`work-login-${t}@example.com`);
    await connect(other, "google-workspace", `shared-${t}@example.com`);
    expect(await connectedElsewhere(db, me, "google-workspace", `shared-${t}@example.com`, null)).toEqual({
      otherSignIn: "p•••@example.com",
    });
  });

  it("is null for this user's own reconnect, and when both already hold it", async () => {
    const t = tag();
    const me = await user(`me-${t}@example.com`);
    const other = await user(`other-${t}@example.com`);
    await connect(me, "google-workspace", `mine-${t}@example.com`);
    expect(await connectedElsewhere(db, me, "google-workspace", `mine-${t}@example.com`, null)).toBeNull();
    await connect(other, "google-workspace", `mine-${t}@example.com`);
    expect(await connectedElsewhere(db, me, "google-workspace", `mine-${t}@example.com`, null)).toBeNull();
  });

  it("matches the connector and the workspace: another connector or workspace is not a duplicate", async () => {
    const t = tag();
    const other = await user(`o-${t}@example.com`);
    const me = await user(`m-${t}@example.com`);
    await connect(other, "atlassian", `x-${t}@example.com`);
    await connect(other, "notion", `n-${t}@example.com`, "ws-a");
    expect(await connectedElsewhere(db, me, "google-workspace", `x-${t}@example.com`, null)).toBeNull();
    expect(await connectedElsewhere(db, me, "notion", `n-${t}@example.com`, "ws-b")).toBeNull();
    expect(await connectedElsewhere(db, me, "notion", `n-${t}@example.com`, "ws-a")).toEqual({
      otherSignIn: "o•••@example.com",
    });
  });

  it("names the most recently connected when several others hold it", async () => {
    const t = tag();
    const older = await user(`aaa-${t}@example.com`);
    const newer = await user(`zzz-${t}@example.com`);
    const me = await user(`me2-${t}@example.com`);
    await connect(older, "google-workspace", `s2-${t}@example.com`, null, new Date("2026-01-01"));
    await connect(newer, "google-workspace", `s2-${t}@example.com`, null, new Date("2026-06-01"));
    expect(await connectedElsewhere(db, me, "google-workspace", `s2-${t}@example.com`, null)).toEqual({
      otherSignIn: "z•••@example.com",
    });
    await db.delete(users).where(eq(users.id, newer));
  });
});
