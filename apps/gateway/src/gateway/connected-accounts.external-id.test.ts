/**
 * SCRUM-366: the connected_accounts key after migration 0022.
 *
 * One Notion login can hold grants in several workspaces, all under the same
 * email, so the key gained `external_account_id` (the workspace id). It is
 * NULLS NOT DISTINCT, because Google and Atlassian rows carry no external id
 * and must stay exactly as unique on (user, connector, email) as before. A
 * plain unique over a nullable column treats every null as different, which
 * would have let two Google rows with one email in silently.
 *
 * Real Postgres via testcontainers, with the drizzle migrations applied: the
 * thing under test IS the constraint, so nothing short of the database can
 * answer.
 */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  connectedAccounts,
  serviceConnections,
  type Database,
} from "@datatorag-mcp/db";
import {
  getTestDb,
  stopTestDb,
  insertTestUser,
  isDockerAvailable,
} from "../test-utils/db";

describe.skipIf(!isDockerAvailable())("connected_accounts key (0022)", () => {
  let db: Database;
  let userId: string;

  beforeAll(async () => {
    db = await getTestDb();
    userId = await insertTestUser(db);
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  async function insertAccount(
    connectorType: string,
    accountEmail: string,
    externalAccountId: string | null
  ) {
    const [conn] = await db
      .insert(serviceConnections)
      .values({ userId, service: connectorType, accessToken: "test-token" })
      .returning({ id: serviceConnections.id });
    await db.insert(connectedAccounts).values({
      userId,
      connectorType,
      accountEmail,
      externalAccountId,
      serviceConnectionId: conn.id,
    });
  }

  /** The error drizzle surfaces wraps the driver's; the constraint name is on
   * the cause. Matched by name so a different failure cannot pass for it. */
  async function expectKeyViolation(p: Promise<unknown>) {
    const err = await p.then(
      () => null,
      (e: unknown) => e
    );
    expect(err).not.toBeNull();
    const text = `${String(err)} ${String((err as { cause?: unknown })?.cause)} ${JSON.stringify(err)}`;
    expect(text).toContain("uq_user_connector_email_external");
  }

  it("still refuses a second Google row with the same email (null external id)", async () => {
    await insertAccount("google-workspace", "same@example.com", null);
    await expectKeyViolation(
      insertAccount("google-workspace", "same@example.com", null)
    );
  });

  it("accepts two Notion workspaces under one email", async () => {
    await insertAccount("notion", "one-login@example.com", "workspace-a");
    await insertAccount("notion", "one-login@example.com", "workspace-b");
    const rows = await db.select().from(connectedAccounts);
    expect(
      rows.filter(
        (r) => r.connectorType === "notion" && r.accountEmail === "one-login@example.com"
      )
    ).toHaveLength(2);
  });

  it("refuses the same Notion workspace twice under one email", async () => {
    await insertAccount("notion", "twice@example.com", "workspace-c");
    await expectKeyViolation(
      insertAccount("notion", "twice@example.com", "workspace-c")
    );
  });
});
