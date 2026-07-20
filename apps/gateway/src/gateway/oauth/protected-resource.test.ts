import { describe, it, expect, vi } from "vitest";
import type { Request, Response } from "express";

// MCP-2: RFC 9728 OAuth 2.0 Protected Resource Metadata. MCP clients read this
// to discover which authorization server protects the /mcp resource.

import { createProtectedResourceRouter } from "./protected-resource";

const BASE = "https://datatorag.com";

function handler() {
  const router = createProtectedResourceRouter(BASE);
  const layer = router.stack.find(
    (l) => l.route?.path === "/.well-known/oauth-protected-resource"
  );
  return layer!.route!.stack[0].handle as (
    req: Request,
    res: Response
  ) => void;
}

function mockRes() {
  const res = {
    json: vi.fn(() => res),
  };
  return res as unknown as Response & { json: ReturnType<typeof vi.fn> };
}

describe("GET /.well-known/oauth-protected-resource", () => {
  it("advertises the /mcp resource and this server as its authorization server", () => {
    const res = mockRes();
    handler()({} as Request, res);
    const body = res.json.mock.calls[0][0];
    expect(body.resource).toBe(`${BASE}/mcp`);
    expect(body.authorization_servers).toEqual([BASE]);
    expect(body.scopes_supported).toEqual(["mcp:tools"]);
    expect(body.bearer_methods_supported).toEqual(["header"]);
  });
});
