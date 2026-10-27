import { describe, expect, it } from "vitest";
import { classifyRefreshFailure, connectionDead } from "./refresh-failure";
import { connectionFailureService, refreshFailedMessage } from "./mcp-server";

/* SCRUM-190: a refused refresh becomes a classified fact, and only a reason
 * known to mean re-consent ever makes a connection dead. */

describe("classifyRefreshFailure", () => {
  it.each([
    [400, { error: "invalid_grant" }, { kind: "permanent", reason: "invalid_grant" }],
    [401, { error: "invalid_grant" }, { kind: "permanent", reason: "invalid_grant" }],
    [400, { error: "invalid_client" }, { kind: "permanent", reason: "invalid_client" }],
    [401, { error: "unauthorized_client" }, { kind: "permanent", reason: "unauthorized_client" }],
    [429, { error: "invalid_grant" }, { kind: "transient", reason: "http_429" }],
    [500, null, { kind: "transient", reason: "http_5xx" }],
    [503, { error: "invalid_grant" }, { kind: "transient", reason: "http_5xx" }],
    [403, { error: "access_denied" }, { kind: "transient", reason: "unexpected" }],
    [400, null, { kind: "transient", reason: "unexpected" }],
    [400, "not json", { kind: "transient", reason: "unexpected" }],
    // invalid_grant outside a 400 or 401 is not understood.
    [409, { error: "invalid_grant" }, { kind: "transient", reason: "unexpected" }],
  ])("HTTP %i with %j is %j", (status, body, expected) => {
    expect(classifyRefreshFailure(status, body)).toEqual(expected);
  });

  it("a thrown fetch is network, and an abort on timeout is timeout", () => {
    expect(classifyRefreshFailure(null, new TypeError("fetch failed"))).toEqual({ kind: "transient", reason: "network" });
    expect(classifyRefreshFailure(null, Object.assign(new Error("t"), { name: "TimeoutError" }))).toEqual({
      kind: "transient",
      reason: "timeout",
    });
    expect(classifyRefreshFailure(null, Object.assign(new Error("a"), { name: "AbortError" }))).toEqual({
      kind: "transient",
      reason: "timeout",
    });
  });

  it("an unknown error value is stored as unexpected, never written through", () => {
    const r = classifyRefreshFailure(400, { error: "something_new<script>" });
    expect(r).toEqual({ kind: "transient", reason: "unexpected" });
  });

  it("never returns the provider's description", () => {
    const r = classifyRefreshFailure(400, {
      error: "invalid_grant",
      error_description: "Token for person@example.com was revoked",
    });
    expect(JSON.stringify(r)).not.toContain("person@example.com");
    expect(JSON.stringify(r)).not.toContain("revoked");
  });
});

describe("connectionDead", () => {
  const row = (lastRefreshError: string | null, refreshPermanentFailures: number) => ({
    lastRefreshError,
    refreshPermanentFailures,
  });

  it("a Google invalid_grant is dead on the first failure", () => {
    expect(connectionDead("google-workspace", row("invalid_grant", 1))).toBe(true);
  });

  it("an Atlassian or Notion invalid_grant takes two consecutive permanent failures", () => {
    expect(connectionDead("atlassian", row("invalid_grant", 1))).toBe(false);
    expect(connectionDead("atlassian", row("invalid_grant", 2))).toBe(true);
    expect(connectionDead("notion", row("invalid_grant", 1))).toBe(false);
    expect(connectionDead("notion", row("invalid_grant", 2))).toBe(true);
  });

  it("Google's other permanent answers take two as well", () => {
    expect(connectionDead("google-workspace", row("invalid_client", 1))).toBe(false);
    expect(connectionDead("google-workspace", row("invalid_client", 2))).toBe(true);
  });

  it("a transient last error after one permanent failure is not dead", () => {
    expect(connectionDead("google-workspace", row("http_5xx", 1))).toBe(false);
    expect(connectionDead("atlassian", row("network", 1))).toBe(false);
  });

  it("a clean row is not dead", () => {
    expect(connectionDead("google-workspace", row(null, 0))).toBe(false);
  });
});

describe("the CallTool words, and what the scheduler pauses on", () => {
  const URL = "https://gw.example.test/dashboard/connections/google-workspace";

  it("a dead grant names the account and the reconnect page, and is recognised", () => {
    const text = refreshFailedMessage(
      { service: "google-workspace", accountEmail: "person@example.com", reconnectNeeded: true },
      URL
    );
    expect(text).toBe(
      `Your Google Workspace account person@example.com needs reconnecting: Google Workspace no longer accepts the access it granted. Reconnect it at ${URL}.`
    );
    expect(connectionFailureService(text)).toBe("google-workspace");
  });

  it("a transient failure says to try again, and is NOT recognised", () => {
    const text = refreshFailedMessage(
      { service: "atlassian", accountEmail: "person@example.com", reconnectNeeded: false },
      "https://gw.example.test/dashboard/connections/atlassian"
    );
    expect(text).toBe("Atlassian did not respond to a token refresh just now. Try the call again in a moment.");
    expect(connectionFailureService(text)).toBeNull();
  });

  it("the existing sentences are still recognised", () => {
    expect(
      connectionFailureService(`google-workspace is not connected. Please connect it from the dashboard at ${URL} before using gws-mcp tools.`)
    ).toBe("google-workspace");
  });
});
