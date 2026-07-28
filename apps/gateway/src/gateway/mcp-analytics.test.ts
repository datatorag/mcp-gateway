import { beforeEach, describe, expect, it, vi } from "vitest";

const capture = vi.fn();
vi.mock("../lib/posthog-server.js", () => ({
  getPosthog: () => ({ capture }),
}));
vi.mock("./user-email.js", () => ({
  resolveUserEmail: vi.fn(async () => "user@example.com"),
  identityProps: (email: string | null) =>
    email ? { user_email: email, $set: { email } } : {},
}));

import {
  classifyAuthFailure,
  extractClientInfo,
  trackMcpRequestReceived,
  trackMcpSessionInitialized,
  trackMcpAuthFailed,
  trackMcpToolsListed,
  MCP_ANONYMOUS_ID,
} from "./mcp-analytics";
import type { Database } from "@datatorag-mcp/db";

const db = {} as Database;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("classifyAuthFailure", () => {
  it("classifies a token we never issued as invalid", () => {
    expect(classifyAuthFailure(null)).toBe("invalid");
    expect(classifyAuthFailure(undefined)).toBe("invalid");
  });

  it("classifies a revoked token as revoked, even when also expired", () => {
    expect(
      classifyAuthFailure({
        revokedAt: new Date("2026-01-01"),
        expiresAt: new Date("2026-01-01"),
      })
    ).toBe("revoked");
  });

  it("classifies a past expiry as expired", () => {
    expect(
      classifyAuthFailure({ revokedAt: null, expiresAt: new Date(Date.now() - 1000) })
    ).toBe("expired");
  });
});

describe("extractClientInfo", () => {
  it("reads clientInfo from an initialize message", () => {
    expect(
      extractClientInfo({
        jsonrpc: "2.0",
        method: "initialize",
        params: { clientInfo: { name: "Claude", version: "1.2.3" } },
      })
    ).toEqual({ name: "Claude", version: "1.2.3" });
  });

  it("finds initialize inside a JSON-RPC batch", () => {
    expect(
      extractClientInfo([
        { method: "notifications/initialized" },
        { method: "initialize", params: { clientInfo: { name: "cursor" } } },
      ])
    ).toEqual({ name: "cursor", version: undefined });
  });

  it("returns {} for non-initialize traffic and malformed bodies", () => {
    expect(extractClientInfo({ method: "tools/list" })).toEqual({});
    expect(extractClientInfo(undefined)).toEqual({});
    expect(extractClientInfo("not json-rpc")).toEqual({});
    expect(
      extractClientInfo({ method: "initialize", params: { clientInfo: "x" } })
    ).toEqual({});
  });

  it("caps runaway string lengths", () => {
    const { name } = extractClientInfo({
      method: "initialize",
      params: { clientInfo: { name: "x".repeat(500) } },
    });
    expect(name).toHaveLength(200);
  });
});

describe("capture identity", () => {
  it("uses the gateway user id as distinctId so the funnel joins", async () => {
    await trackMcpSessionInitialized(db, "user-123", { clientName: "Claude" });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user-123",
        event: "mcp_session_initialized",
        properties: expect.objectContaining({
          client_name: "Claude",
          transport: "streamable_http",
          authenticated: true,
          user_email: "user@example.com",
        }),
      })
    );
  });

  it("captures unauthenticated requests under the stable anonymous id", async () => {
    await trackMcpRequestReceived(db, {
      userId: null,
      action: "initialize",
      method: "POST",
    });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: MCP_ANONYMOUS_ID,
        properties: expect.objectContaining({ authenticated: false }),
      })
    );
    const props = capture.mock.calls[0][0].properties;
    expect(props.user_email).toBeUndefined();
  });

  it("attributes expired-token failures to the token's owner", async () => {
    await trackMcpAuthFailed(db, {
      userId: "user-123",
      reason: "expired",
      method: "POST",
    });
    expect(capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "user-123",
        event: "mcp_auth_failed",
        properties: expect.objectContaining({ reason: "expired" }),
      })
    );
  });

  it("sends the tool count and nothing about the tools themselves", async () => {
    await trackMcpToolsListed(db, "user-123", 76);
    const { properties } = capture.mock.calls[0][0];
    expect(properties.tool_count).toBe(76);
    expect(Object.keys(properties).sort()).toEqual([
      "$set",
      "authenticated",
      "tool_count",
      "user_email",
    ]);
  });
});
