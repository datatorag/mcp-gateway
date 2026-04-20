import { describe, it, expect } from "vitest";
import { classifyOutcome } from "./classify";

describe("classifyOutcome", () => {
  it("classifies successful tool call as success + metered", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: false,
      source: "mcp",
    });
    expect(r).toEqual({ status: "success", meter: true });
  });

  it("classifies MCP isError=true as user_error + metered", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: true,
      errorMessage: "Invalid argument: message_id is required",
      source: "mcp",
    });
    expect(r).toEqual({ status: "user_error", meter: true });
  });

  it("classifies thrown exception with timeout as server_error + not metered", () => {
    const r = classifyOutcome({
      thrown: true,
      errorMessage: "Request timed out after 30s",
      source: "mcp",
    });
    expect(r).toEqual({ status: "server_error", meter: false });
  });

  it("classifies thrown exception with 5xx-like message as server_error + not metered", () => {
    const r = classifyOutcome({
      thrown: true,
      errorMessage: "500 Internal Server Error from upstream",
      source: "mcp",
    });
    expect(r).toEqual({ status: "server_error", meter: false });
  });

  it("classifies thrown exception with generic error as server_error + not metered", () => {
    const r = classifyOutcome({
      thrown: true,
      errorMessage: "ECONNREFUSED",
      source: "mcp",
    });
    expect(r).toEqual({ status: "server_error", meter: false });
  });

  it("does not meter playground calls regardless of status", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: false,
      source: "playground",
    });
    expect(r.meter).toBe(false);
  });

  it("does not meter oauth-refresh tool calls", () => {
    const r = classifyOutcome({
      thrown: false,
      isError: false,
      source: "mcp",
      toolName: "gws_auth_refresh",
    });
    expect(r.meter).toBe(false);
  });
});
