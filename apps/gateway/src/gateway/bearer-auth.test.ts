/**
 * The bearer on /mcp is an OAuth access token and nothing else (SCRUM-451).
 *
 * API keys were a second way in (SCRUM-245) and are gone. A value in their
 * format is an unknown token: it is looked up as an access token, found in
 * no row, and refused like any other, with no second table consulted.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

type Row = Record<string, unknown>;
const selectResults: Row[][] = [];
let selects = 0;

function chainable(result: unknown) {
  const p = Promise.resolve(result) as Promise<unknown> & Record<string, unknown>;
  for (const m of ["from", "where", "leftJoin", "orderBy", "limit"]) p[m] = () => p;
  return p;
}
const db = {
  select: () => {
    selects++;
    return chainable(selectResults.shift() ?? []);
  },
} as unknown as Database;

const bearerAuth = await import("./bearer-auth");
const { resolveBearer } = bearerAuth;

const LIVE = { revokedAt: null, expiresAt: null };
const OLD_KEY_FORMAT = "sk-dtrmcp_abcdefghijklmnopqrstuvwxyz0123456789ABCDEF";

beforeEach(() => {
  selectResults.length = 0;
  selects = 0;
});

describe("OAuth is the only bearer (SCRUM-451)", () => {
  it("an access token resolves to its user and its own client id", async () => {
    selectResults.push([{ userId: "user-2", clientId: "client-xyz", ...LIVE }]);
    expect(await resolveBearer(db, "opaque-oauth-access-token")).toEqual({
      ok: true,
      userId: "user-2",
      clientId: "client-xyz",
    });
  });

  it("an expired or revoked access token is refused, naming the owner so the failure attributes", async () => {
    selectResults.push([{ userId: "user-2", clientId: "client-xyz", revokedAt: null, expiresAt: new Date("2026-01-01T00:00:00Z") }]);
    expect(await resolveBearer(db, "opaque-oauth-access-token")).toEqual({ ok: false, reason: "expired", userId: "user-2" });
    selectResults.push([{ userId: "user-2", clientId: "client-xyz", revokedAt: new Date("2026-09-10T00:00:00Z"), expiresAt: null }]);
    expect(await resolveBearer(db, "opaque-oauth-access-token")).toEqual({ ok: false, reason: "revoked", userId: "user-2" });
  });

  it("a bearer in the old API key format is an unknown token, looked up once, as an access token", async () => {
    expect(await resolveBearer(db, OLD_KEY_FORMAT)).toEqual({ ok: false, reason: "invalid", userId: null });
    expect(selects).toBe(1);
  });

  it("an unknown token is refused as invalid", async () => {
    expect(await resolveBearer(db, "never-issued")).toEqual({ ok: false, reason: "invalid", userId: null });
  });

  it("the module no longer offers a way to mint, list, revoke or recognise a key", () => {
    for (const name of ["createApiKey", "listApiKeys", "revokeApiKey", "touchApiKey", "isApiKeyShaped", "API_KEY_CLIENT_ID"]) {
      expect(bearerAuth, name).not.toHaveProperty(name);
    }
  });
});

describe("the /mcp body gate (SCRUM-437)", () => {
  /** A real express app with the gate and a handler that reports what it
   * saw, on an ephemeral port. */
  async function serve(validate: (token: string) => Promise<import("./bearer-auth").BearerAuth>) {
    const express = (await import("express")).default;
    const { mcpBearerGate } = await import("./bearer-auth");
    const app = express();
    app.use("/mcp", mcpBearerGate(validate, { authed: express.json({ limit: "2mb" }), unauthed: express.json() }));
    app.all("/mcp", (req, res) => {
      res.json({ state: res.locals.mcpAuth, bodyKeys: req.body && typeof req.body === "object" ? Object.keys(req.body) : null });
    });
    const server = await new Promise<import("node:http").Server>((resolve) => {
      const s = app.listen(0, () => resolve(s));
    });
    const { port } = server.address() as import("node:net").AddressInfo;
    return { url: `http://127.0.0.1:${port}/mcp`, close: () => new Promise((r) => server.close(r)) };
  }
  const valid = async () => ({ ok: true as const, userId: "u1", clientId: "c1", authKind: "oauth" as const });
  const invalid = async () => ({ ok: false as const, reason: "invalid" as AuthFailureReasonForTest, userId: null });
  type AuthFailureReasonForTest = Extract<import("./bearer-auth").BearerAuth, { ok: false }>["reason"];
  const body = (bytes: number) => JSON.stringify({ jsonrpc: "2.0", method: "tools/call", params: { pad: "x".repeat(bytes) } });

  it("parses a 1.4 MB body for a valid bearer", async () => {
    const s = await serve(valid);
    try {
      const res = await fetch(s.url, { method: "POST", headers: { authorization: "Bearer good", "content-type": "application/json" }, body: body(1_400_000) });
      expect(res.status).toBe(200);
      const seen = await res.json();
      expect(seen.state).toEqual({ header: "present", auth: { ok: true, userId: "u1", clientId: "c1", authKind: "oauth" } });
      expect(seen.bodyKeys).toEqual(["jsonrpc", "method", "params"]);
    } finally {
      await s.close();
    }
  });

  it("refuses a body over 2 MB for a valid bearer", async () => {
    const s = await serve(valid);
    try {
      const res = await fetch(s.url, { method: "POST", headers: { authorization: "Bearer good", "content-type": "application/json" }, body: body(2_200_000) });
      expect(res.status).toBe(413);
    } finally {
      await s.close();
    }
  });

  it.each([
    ["no bearer", {}],
    ["a bearer that fails validation", { authorization: "Bearer bad" }],
  ])("keeps today's 100 KB limit with %s, so the larger limit is only ever an authenticated caller's", async (_label, auth) => {
    const s = await serve(invalid);
    try {
      const small = await fetch(s.url, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: body(1_000) });
      expect(small.status).toBe(200);
      // Still parsed, so a refused request can say which client it was.
      expect((await small.json()).bodyKeys).toEqual(["jsonrpc", "method", "params"]);
      const large = await fetch(s.url, { method: "POST", headers: { ...auth, "content-type": "application/json" }, body: body(200_000) });
      expect(large.status).toBe(413);
    } finally {
      await s.close();
    }
  });

  it("records a missing header apart from a failed one", async () => {
    const s = await serve(invalid);
    try {
      const none = await (await fetch(s.url, { method: "GET" })).json();
      expect(none.state).toEqual({ header: "missing" });
      const bad = await (await fetch(s.url, { method: "GET", headers: { authorization: "Bearer bad" } })).json();
      expect(bad.state.header).toBe("present");
      expect(bad.state.auth.ok).toBe(false);
    } finally {
      await s.close();
    }
  });
});
