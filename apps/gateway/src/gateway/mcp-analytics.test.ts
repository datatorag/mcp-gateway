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
    await trackMcpToolsListed(db, "user-123", { connectorTools: 70, builtinTools: 6 });
    const { properties } = capture.mock.calls[0][0];
    expect(properties.tool_count).toBe(76);
    // Counts and client identity; no key that could carry a tool name.
    expect(Object.keys(properties).sort()).toEqual([
      "$set",
      "authenticated",
      "builtin_tools",
      "client_name",
      "client_version",
      "connector_tools",
      "protocol_version",
      "tool_count",
      "user_email",
    ]);
  });
});

/* SCRUM-256: the tools-listed event says who listed, over which protocol,
 * and how the count splits between connector tools and gateway built-ins.
 * Still nothing about the tools themselves. */
describe("what a tools/list says about the client (SCRUM-256)", () => {
  it("reads the protocol version off the initialize message beside clientInfo", () => {
    expect(
      extractClientInfo({
        jsonrpc: "2.0",
        method: "initialize",
        params: { protocolVersion: "2025-06-18", clientInfo: { name: "Claude", version: "1.2.3" } },
      })
    ).toEqual({ name: "Claude", version: "1.2.3", protocolVersion: "2025-06-18" });
    expect(
      extractClientInfo({ method: "initialize", params: { protocolVersion: 42, clientInfo: { name: "x" } } })
        .protocolVersion
    ).toBeUndefined();
    expect(
      extractClientInfo({ method: "initialize", params: { protocolVersion: "v".repeat(200), clientInfo: {} } })
        .protocolVersion
    ).toHaveLength(50);
  });

  it("sends the split count and the client identity, and still nothing about the tools", async () => {
    await trackMcpToolsListed(db, "user-123", {
      connectorTools: 70,
      builtinTools: 6,
      clientName: "Claude",
      clientVersion: "1.2.3",
      protocolVersion: "2025-06-18",
    });
    const { properties } = capture.mock.calls[0][0];
    expect(properties).toMatchObject({
      tool_count: 76,
      connector_tools: 70,
      builtin_tools: 6,
      client_name: "Claude",
      client_version: "1.2.3",
      protocol_version: "2025-06-18",
    });
    expect(Object.keys(properties).sort()).toEqual([
      "$set",
      "authenticated",
      "builtin_tools",
      "client_name",
      "client_version",
      "connector_tools",
      "protocol_version",
      "tool_count",
      "user_email",
    ]);
  });

  it("writes null, not undefined, when the client said nothing about itself", async () => {
    await trackMcpToolsListed(db, "user-123", { connectorTools: 0, builtinTools: 6 });
    const { properties } = capture.mock.calls[0][0];
    expect(properties).toMatchObject({
      tool_count: 6,
      client_name: null,
      client_version: null,
      protocol_version: null,
    });
  });
});
