/**
 * SCRUM-366: several Notion workspaces under one login.
 *
 * One Notion login can authorize the connection in several workspaces, and
 * every one of those grants carries the same email. Before the key gained
 * the workspace id, the second connect found the first row by email and
 * overwrote its tokens. These pin, on real Postgres, the three things that
 * change with the key: what an upsert updates, what the `account` argument
 * routes to, and that an ambiguous value is refused with its choices rather
 * than guessed. Google is pinned unchanged beside them (the default-account
 * suite holds the rest of its behaviour).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/google-revoke", () => ({
  revokeGoogleToken: vi.fn(async () => true),
}));

import { and, eq } from "drizzle-orm";
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
import {
  disconnectAccount,
  listConnectedAccounts,
  upsertServiceAccount,
} from "./connected-accounts";
import { ambiguousAccountMessage, resolveServiceToken } from "./service-token";

const NOTION = "notion";
const EMAIL = "person@example.com";

describe.skipIf(!isDockerAvailable())("SCRUM-366: Notion workspaces as accounts", () => {
  let db: Database;

  beforeAll(async () => {
    db = await getTestDb();
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  /** One Notion connect callback, as auth.ts drives it. */
  async function connectNotion(
    userId: string,
    email: string,
    workspaceId: string,
    workspaceName: string,
    access: string,
    refresh: string
  ) {
    await upsertServiceAccount(
      db,
      userId,
      NOTION,
      email,
      { access_token: access, refresh_token: refresh },
      null,
      null,
      { externalAccountId: workspaceId, label: workspaceName }
    );
  }

  async function notionRows(userId: string) {
    return db
      .select({
        id: connectedAccounts.id,
        email: connectedAccounts.accountEmail,
        workspaceId: connectedAccounts.externalAccountId,
        label: connectedAccounts.label,
        isDefault: connectedAccounts.isDefault,
        connId: serviceConnections.id,
        access: serviceConnections.accessToken,
        refresh: serviceConnections.refreshToken,
        expires: serviceConnections.tokenExpiresAt,
      })
      .from(connectedAccounts)
      .innerJoin(
        serviceConnections,
        eq(connectedAccounts.serviceConnectionId, serviceConnections.id)
      )
      .where(
        and(
          eq(connectedAccounts.userId, userId),
          eq(connectedAccounts.connectorType, NOTION)
        )
      );
  }

  describe("upsert", () => {
    it("a second workspace under the same email is a new row, and the first one's tokens are untouched", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a1", "refresh-a1");
      await connectNotion(userId, EMAIL, "ws-b", "Beta", "access-b1", "refresh-b1");

      const rows = await notionRows(userId);
      expect(rows).toHaveLength(2);
      const a = rows.find((r) => r.workspaceId === "ws-a")!;
      const b = rows.find((r) => r.workspaceId === "ws-b")!;
      expect(a).toMatchObject({ access: "access-a1", refresh: "refresh-a1", label: "Acme", expires: null });
      expect(b).toMatchObject({ access: "access-b1", refresh: "refresh-b1", label: "Beta", expires: null });
      expect(a.connId).not.toBe(b.connId);
    });

    it("reconnecting the same workspace replaces only its own tokens", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a1", "refresh-a1");
      await connectNotion(userId, EMAIL, "ws-b", "Beta", "access-b1", "refresh-b1");
      const before = await notionRows(userId);

      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a2", "refresh-a2");

      const after = await notionRows(userId);
      expect(after).toHaveLength(2);
      const a = after.find((r) => r.workspaceId === "ws-a")!;
      const b = after.find((r) => r.workspaceId === "ws-b")!;
      expect(a).toMatchObject({ access: "access-a2", refresh: "refresh-a2" });
      // Same rows, not replacements.
      expect(a.id).toBe(before.find((r) => r.workspaceId === "ws-a")!.id);
      expect(b).toMatchObject({ access: "access-b1", refresh: "refresh-b1" });
      expect(b.id).toBe(before.find((r) => r.workspaceId === "ws-b")!.id);
    });

    it("a renamed workspace's label follows on reconnect", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a1", "refresh-a1");
      await connectNotion(userId, EMAIL, "ws-a", "Acme Renamed", "access-a2", "refresh-a2");
      const rows = await notionRows(userId);
      expect(rows).toHaveLength(1);
      expect(rows[0].label).toBe("Acme Renamed");
    });

    it("a Google reconnect still finds its row by email alone (null external id)", async () => {
      const userId = await insertTestUser(db);
      const scope = "openid https://www.googleapis.com/auth/userinfo.email";
      await upsertServiceAccount(db, userId, "google-workspace", EMAIL, { access_token: "g1", scope }, scope, null);
      await upsertServiceAccount(db, userId, "google-workspace", EMAIL, { access_token: "g2", scope }, scope, null);
      const rows = await db
        .select({ access: serviceConnections.accessToken, ext: connectedAccounts.externalAccountId, label: connectedAccounts.label })
        .from(connectedAccounts)
        .innerJoin(serviceConnections, eq(connectedAccounts.serviceConnectionId, serviceConnections.id))
        .where(eq(connectedAccounts.userId, userId));
      expect(rows).toEqual([{ access: "g2", ext: null, label: null }]);
    });
  });

  describe("defaults with two workspaces", () => {
    it("the first workspace is the default, the second is not, and a disconnect promotes the other", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a1", "refresh-a1");
      await connectNotion(userId, EMAIL, "ws-b", "Beta", "access-b1", "refresh-b1");

      let rows = await notionRows(userId);
      expect(rows.filter((r) => r.isDefault).map((r) => r.workspaceId)).toEqual(["ws-a"]);

      // An argument-less call runs as the default.
      const resolved = await resolveServiceToken(db, userId, NOTION);
      expect(resolved).toMatchObject({ token: "access-a1", accountEmail: EMAIL });

      // Reconnecting the second does not move the default.
      await connectNotion(userId, EMAIL, "ws-b", "Beta", "access-b2", "refresh-b2");
      rows = await notionRows(userId);
      expect(rows.filter((r) => r.isDefault).map((r) => r.workspaceId)).toEqual(["ws-a"]);

      await disconnectAccount(db, userId, rows.find((r) => r.workspaceId === "ws-a")!.id);
      rows = await notionRows(userId);
      expect(rows.map((r) => [r.workspaceId, r.isDefault])).toEqual([["ws-b", true]]);
    });
  });

  describe("routing the account argument", () => {
    it("an email that matches two workspaces is refused, with both choices named", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a1", "refresh-a1");
      await connectNotion(userId, EMAIL, "ws-b", "Beta", "access-b1", "refresh-b1");

      const resolved = await resolveServiceToken(db, userId, NOTION, EMAIL);
      expect(resolved).not.toBeNull();
      expect(resolved && "ambiguous" in resolved).toBe(true);
      if (!resolved || !("ambiguous" in resolved)) return;
      // Never a token on a refusal.
      expect("token" in resolved).toBe(false);
      expect(resolved.choices).toEqual(
        expect.arrayContaining([
          { account: "Acme", email: EMAIL, workspace: "Acme" },
          { account: "Beta", email: EMAIL, workspace: "Beta" },
        ])
      );
      expect(resolved.choices).toHaveLength(2);

      const message = ambiguousAccountMessage(EMAIL, resolved.choices);
      expect(message).toContain(EMAIL);
      expect(message).toContain('"Acme"');
      expect(message).toContain('"Beta"');
    });

    it("the workspace name resolves to that workspace's token", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a1", "refresh-a1");
      await connectNotion(userId, EMAIL, "ws-b", "Beta", "access-b1", "refresh-b1");
      expect(await resolveServiceToken(db, userId, NOTION, "Beta")).toEqual({
        token: "access-b1",
        accountEmail: EMAIL,
        scopes: null,
      });
      expect(await resolveServiceToken(db, userId, NOTION, "Acme")).toMatchObject({ token: "access-a1" });
    });

    it("the workspace id resolves too", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a1", "refresh-a1");
      await connectNotion(userId, EMAIL, "ws-b", "Beta", "access-b1", "refresh-b1");
      expect(await resolveServiceToken(db, userId, NOTION, "ws-b")).toMatchObject({ token: "access-b1" });
    });

    it("an email with a single workspace still resolves by email", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a1", "refresh-a1");
      await connectNotion(userId, EMAIL, "ws-b", "Beta", "access-b1", "refresh-b1");
      await connectNotion(userId, "other@example.com", "ws-c", "Gamma", "access-c1", "refresh-c1");
      expect(await resolveServiceToken(db, userId, NOTION, "other@example.com")).toMatchObject({
        token: "access-c1",
        accountEmail: "other@example.com",
      });
    });

    it("two workspaces with the same name are offered by id, never by the name that is itself ambiguous", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Team", "access-a1", "refresh-a1");
      await connectNotion(userId, EMAIL, "ws-b", "Team", "access-b1", "refresh-b1");

      const byName = await resolveServiceToken(db, userId, NOTION, "Team");
      expect(byName && "ambiguous" in byName).toBe(true);
      const byEmail = await resolveServiceToken(db, userId, NOTION, EMAIL);
      if (!byEmail || !("ambiguous" in byEmail)) throw new Error("expected a refusal");
      expect(byEmail.choices.map((c) => c.account).sort()).toEqual(["ws-a", "ws-b"]);
    });

    it("an unknown value resolves to nothing", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a1", "refresh-a1");
      expect(await resolveServiceToken(db, userId, NOTION, "Nope")).toBeNull();
    });

    it("Google is unchanged: routed by email only, a label is not an account name", async () => {
      const userId = await insertTestUser(db);
      const scope = "openid https://www.googleapis.com/auth/userinfo.email";
      await upsertServiceAccount(db, userId, "google-workspace", EMAIL, { access_token: "g1", scope }, scope, null);
      await db
        .update(connectedAccounts)
        .set({ label: "work" })
        .where(eq(connectedAccounts.userId, userId));
      expect(await resolveServiceToken(db, userId, "google-workspace", EMAIL)).toMatchObject({ token: "g1" });
      expect(await resolveServiceToken(db, userId, "google-workspace", "work")).toBeNull();
    });
  });

  describe("listing", () => {
    it("carries the workspace name and id for Notion rows", async () => {
      const userId = await insertTestUser(db);
      await connectNotion(userId, EMAIL, "ws-a", "Acme", "access-a1", "refresh-a1");
      const rows = await listConnectedAccounts(db, userId);
      expect(rows).toEqual([
        expect.objectContaining({ connectorType: NOTION, label: "Acme", externalAccountId: "ws-a" }),
      ]);
    });
  });
});
