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

  it("meters the agent surface, the same as the gateway", () => {
    // REVERSED deliberately (SCRUM-57). This surface returned meter:false and
    // therefore wrote no usage row at all. The paid tier sells volume, so a
    // surface that does not meter is a volume path that does not count.
    expect(classifyOutcome({ thrown: false, source: "agent" }).meter).toBe(true);
    expect(
      classifyOutcome({ thrown: false, isError: true, source: "agent" }).meter
    ).toBe(true);
  });

  it("still never meters a call we broke ourselves, on either surface", () => {
    for (const source of ["mcp", "agent"] as const) {
      expect(classifyOutcome({ thrown: true, source }).meter).toBe(false);
    }
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
