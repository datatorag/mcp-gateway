/**
 * SCRUM-464: what a refused /mcp request says about its caller, for the
 * mcp_auth_failed event and the log line. One case per reason_detail, and
 * the rules that keep it free of credentials and people.
 */
import { describe, expect, it } from "vitest";
import type { Request } from "express";
import type { McpAuthState } from "./bearer-auth";
import { authFailureContext, networkPrefix, peerHash } from "./auth-failure-context";

const TOKEN = "tok-secret-value-never-logged";

function req(headers: Record<string, string> = {}, originalUrl = "/mcp", remoteAddress = "198.51.100.7"): Request {
  return { headers, originalUrl, path: originalUrl.split("?")[0], socket: { remoteAddress } } as unknown as Request;
}

const refused = (reason: "invalid" | "expired" | "revoked" | "wrong_token_kind"): McpAuthState => ({
  header: "present",
  auth: { ok: false, reason, userId: null },
  emptyToken: false,
});

describe("reason_detail", () => {
  it.each<[string, McpAuthState, string]>([
    ["no Authorization header", { header: "missing", authorization: "absent" }, "no_header"],
    ["a header that is not Bearer", { header: "missing", authorization: "not_bearer" }, "malformed"],
    ["Bearer with an empty token", { header: "present", auth: { ok: false, reason: "invalid", userId: null }, emptyToken: true }, "malformed"],
    ["a bearer matching no token we issued", refused("invalid"), "unknown_prefix"],
    ["an expired token", refused("expired"), "expired"],
    ["a revoked token", refused("revoked"), "revoked"],
    ["a web session sent as a bearer", refused("wrong_token_kind"), "wrong_token_kind"],
  ])("%s is %s", (_what, state, detail) => {
    expect(authFailureContext(req(), state, {}, "salt").reason_detail).toBe(detail);
  });

  it("bearer_present is true only for a non-empty Bearer token", () => {
    expect(authFailureContext(req(), { header: "missing", authorization: "absent" }, {}, "s").bearer_present).toBe(false);
    expect(authFailureContext(req(), refused("expired"), {}, "s").bearer_present).toBe(true);
    expect(
      authFailureContext(req(), { header: "present", auth: { ok: false, reason: "invalid", userId: null }, emptyToken: true }, {}, "s")
        .bearer_present
    ).toBe(false);
  });
});

describe("the caller's description", () => {
  const missing: McpAuthState = { header: "missing", authorization: "absent" };

  it("path drops the query string, which can carry anything", () => {
    expect(authFailureContext(req({}, `/mcp?token=${TOKEN}`), missing, {}, "s").path).toBe("/mcp");
  });

  it("user_agent is cleaned and capped at 120 characters", () => {
    const ua = authFailureContext(req({ "user-agent": `mcpbeat/1.0\n${"x".repeat(300)}` }), missing, {}, "s").user_agent!;
    expect(ua.length).toBeLessThanOrEqual(120);
    expect(ua).toMatch(/^mcpbeat\/1\.0 x+/);
    expect(ua).not.toContain("\n");
  });

  it("client name and version come from an initialize body, cleaned", () => {
    const ctx = authFailureContext(req(), missing, { name: "Claude‮", version: "1.2.3" }, "s");
    expect(ctx).toMatchObject({ client_name: "Claude", client_version: "1.2.3" });
  });

  it("the peer is CF-Connecting-IP, never the client-supplied X-Forwarded-For", () => {
    const ctx = authFailureContext(
      req({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.9.9.9, 203.0.113.9" }),
      missing,
      {},
      "salt"
    );
    expect(ctx.peer_prefix).toBe("203.0.113.0/24");
    expect(ctx.peer_hash).toBe(peerHash("203.0.113.9", "salt"));
  });

  it("with no salt configured there is no hash, only the prefix", () => {
    const ctx = authFailureContext(req({ "cf-connecting-ip": "203.0.113.9" }), missing, {}, "");
    expect(ctx.peer_hash).toBeNull();
    expect(ctx.peer_prefix).toBe("203.0.113.0/24");
    expect(peerHash("203.0.113.9", "  ")).toBeNull();
  });

  it("without CF-Connecting-IP the peer is the socket address", () => {
    expect(authFailureContext(req({}, "/mcp", "198.51.100.7"), missing, {}, "s").peer_prefix).toBe("198.51.100.0/24");
  });

  it("never carries the raw IP, the token or an email", () => {
    const ctx = authFailureContext(
      req({ authorization: `Bearer ${TOKEN}`, "cf-connecting-ip": "203.0.113.9", "user-agent": "node" }),
      refused("invalid"),
      {},
      "salt"
    );
    const text = JSON.stringify(ctx);
    expect(text).not.toContain(TOKEN);
    expect(text).not.toContain("203.0.113.9");
    expect(text).not.toMatch(/@/);
  });
});

describe("networkPrefix", () => {
  it.each([
    ["192.0.2.44", "192.0.2.0/24"],
    ["::ffff:192.0.2.44", "192.0.2.0/24"],
    ["2001:db8:abcd:12::1", "2001:db8:abcd::/48"],
    ["2001:db8::1", "2001:db8:0::/48"],
    ["not-an-ip", null],
  ])("%s is %s", (ip, prefix) => {
    expect(networkPrefix(ip)).toBe(prefix);
  });
});
