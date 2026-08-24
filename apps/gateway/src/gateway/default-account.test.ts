/**
 * SCRUM-145: a user who reconnects with full scopes must not stay broken.
 *
 * The failure shape this pins, reproduced from production: the FIRST account a
 * user connects wins `is_default` and keeps it forever, so a user whose first
 * consent granted identity scopes only (no Gmail, no Drive) stays refused on
 * every tool call even after they do exactly what the SCRUM-136 error message
 * tells them and connect a second account with the full grant. The resolver
 * keeps picking the identity-only default, permanently.
 *
 * The rule under test: a default that can serve at least one service is never
 * moved (a deliberately narrow default is a choice, and clobbering it is its
 * own bug); a default that can serve NOTHING is not a choice anyone made, and
 * it yields to a usable grant the moment one exists.
 *
 * Real Postgres via testcontainers: this is precisely the join + flag
 * interplay a chainable stub would fake its way past. Gated on Docker per the
 * harness convention; on this bug the suite was run with Docker present, red
 * first, so the skip path has never been the evidence.
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
import { disconnectAccount, upsertServiceAccount } from "./connected-accounts";
import { resolveServiceToken } from "./service-token";
import { checkScopeForTool } from "./scope-grant";

const GWS = "google-workspace";

/** Granted strings in Google's stored spelling, as production rows carry them. */
const IDENTITY_ONLY =
  "openid https://www.googleapis.com/auth/userinfo.email";
const GMAIL_ONLY =
  "openid https://www.googleapis.com/auth/userinfo.email " +
  "https://www.googleapis.com/auth/gmail.modify";
const FULL_GRANT = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

describe.skipIf(!isDockerAvailable())(
  "SCRUM-145: default-account selection and resolution",
  () => {
    let db: Database;

    beforeAll(async () => {
      db = await getTestDb();
    });

    afterAll(async () => {
      await stopTestDb();
    });

    /** One OAuth connect callback, as auth.ts drives it. */
    async function connect(userId: string, email: string, scope: string) {
      await upsertServiceAccount(
        db,
        userId,
        GWS,
        email,
        { access_token: `tok-${email}-${scope.length}`, refresh_token: "rt", scope },
        FULL_GRANT,
        new Date(Date.now() + 3600_000)
      );
    }

    /** The single default account's email — and asserts there IS exactly one,
     * because two defaults (or zero) is its own corruption. */
    async function defaultEmailOf(userId: string): Promise<string> {
      const rows = await db
        .select({ accountEmail: connectedAccounts.accountEmail })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.userId, userId),
            eq(connectedAccounts.connectorType, GWS),
            eq(connectedAccounts.isDefault, true)
          )
        );
      expect(rows).toHaveLength(1);
      return rows[0].accountEmail;
    }

    it("the production repro: identity-only first, full grant second — the user who complies with the error sees it work", async () => {
      const userId = await insertTestUser(db);

      // Step 1: first consent grants identity only. It becomes the default.
      await connect(userId, "identity-first@example.com", IDENTITY_ONLY);
      let resolved = await resolveServiceToken(db, userId, GWS);
      expect(resolved?.accountEmail).toBe("identity-first@example.com");
      expect(
        checkScopeForTool({
          toolName: "gws-mcp__gmail_search",
          service: GWS,
          granted: resolved!.scopes,
          surface: "mcp",
        }).ok
      ).toBe(false);

      // Step 2: the user does exactly what the error says and connects an
      // account with the full grant.
      await connect(userId, "full-second@example.com", FULL_GRANT);

      // The very next argument-less call must resolve to the account that can
      // actually serve it — this is the line that reproduces the bug.
      resolved = await resolveServiceToken(db, userId, GWS);
      expect(resolved?.accountEmail).toBe("full-second@example.com");
      expect(
        checkScopeForTool({
          toolName: "gws-mcp__gmail_search",
          service: GWS,
          granted: resolved!.scopes,
          surface: "mcp",
        }).ok
      ).toBe(true);

      // And the flag itself moved, so every other consumer of the default
      // (agent sessions, the dashboard) agrees with the resolver.
      expect(await defaultEmailOf(userId)).toBe("full-second@example.com");
    });

    it("a deliberately narrow default is never clobbered by a wider later account", async () => {
      const userId = await insertTestUser(db);

      // Gmail-only is a usable grant — a user may well WANT the narrow
      // account acting by default.
      await connect(userId, "narrow-default@example.com", GMAIL_ONLY);
      await connect(userId, "wide-later@example.com", FULL_GRANT);

      expect(await defaultEmailOf(userId)).toBe("narrow-default@example.com");
      const resolved = await resolveServiceToken(db, userId, GWS);
      expect(resolved?.accountEmail).toBe("narrow-default@example.com");
    });

    it("re-granting an EXISTING non-default account also rescues an unusable default", async () => {
      const userId = await insertTestUser(db);

      await connect(userId, "identity-a@example.com", IDENTITY_ONLY);
      await connect(userId, "identity-b@example.com", IDENTITY_ONLY);
      expect(await defaultEmailOf(userId)).toBe("identity-a@example.com");

      // The user reconnects B and this time grants everything — the
      // existing-row update path, not an insert.
      await connect(userId, "identity-b@example.com", FULL_GRANT);

      expect(await defaultEmailOf(userId)).toBe("identity-b@example.com");
      const resolved = await resolveServiceToken(db, userId, GWS);
      expect(resolved?.accountEmail).toBe("identity-b@example.com");
    });

    it("two identity-only accounts: the default stays put — moving it would gain nothing", async () => {
      const userId = await insertTestUser(db);

      await connect(userId, "identity-one@example.com", IDENTITY_ONLY);
      await connect(userId, "identity-two@example.com", IDENTITY_ONLY);

      expect(await defaultEmailOf(userId)).toBe("identity-one@example.com");
    });

    it("disconnecting the default promotes a USABLE account, not merely the oldest", async () => {
      const userId = await insertTestUser(db);

      // Narrow-but-usable default, then an identity-only account (older),
      // then a full one (newer). The default holds through both connects.
      await connect(userId, "leaving@example.com", GMAIL_ONLY);
      await connect(userId, "identity-old@example.com", IDENTITY_ONLY);
      await connect(userId, "full-new@example.com", FULL_GRANT);
      expect(await defaultEmailOf(userId)).toBe("leaving@example.com");

      const [row] = await db
        .select({ id: connectedAccounts.id })
        .from(connectedAccounts)
        .where(
          and(
            eq(connectedAccounts.userId, userId),
            eq(connectedAccounts.accountEmail, "leaving@example.com")
          )
        );
      await disconnectAccount(db, userId, row.id);

      // Oldest-first promotion would hand the default to the identity-only
      // account and recreate the exact SCRUM-145 state on the disconnect path.
      expect(await defaultEmailOf(userId)).toBe("full-new@example.com");
    });

    it("legacy fallback (no connected_accounts rows) is deterministic: widest grant first, then most recent", async () => {
      const userId = await insertTestUser(db);

      // Two un-migrated rows: identity-only inserted FIRST, so an unordered
      // limit(1) returns it by heap order and the assertion below goes red.
      await db.insert(serviceConnections).values({
        userId,
        service: GWS,
        accessToken: "legacy-identity",
        scopes: IDENTITY_ONLY,
        connectedAt: new Date("2026-01-01T00:00:00Z"),
      });
      await db.insert(serviceConnections).values({
        userId,
        service: GWS,
        accessToken: "legacy-full",
        scopes: FULL_GRANT,
        connectedAt: new Date("2026-02-01T00:00:00Z"),
      });

      const resolved = await resolveServiceToken(db, userId, GWS);
      expect(resolved?.token).toBe("legacy-full");
      // Legacy rows carry no account identity — that contract is unchanged.
      expect(resolved?.accountEmail).toBeNull();

      // Equal width: the most recently connected row wins, so the pick can
      // never flap between two calls.
      const tieUser = await insertTestUser(db);
      await db.insert(serviceConnections).values({
        userId: tieUser,
        service: GWS,
        accessToken: "tie-older",
        scopes: FULL_GRANT,
        connectedAt: new Date("2026-01-01T00:00:00Z"),
      });
      await db.insert(serviceConnections).values({
        userId: tieUser,
        service: GWS,
        accessToken: "tie-newer",
        scopes: FULL_GRANT,
        connectedAt: new Date("2026-02-01T00:00:00Z"),
      });
      const tied = await resolveServiceToken(db, tieUser, GWS);
      expect(tied?.token).toBe("tie-newer");
    });
  }
);
