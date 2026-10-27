import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import type { Database } from "@datatorag-mcp/db";

// SEC-4: the gateway is a public-client-only authorization server. Every
// registration must be recorded and echoed as token_endpoint_auth_method="none",
// even if the client asks for client_secret_post — we never issue a secret.

import { createRegisterRouter } from "./register";

const insertValues = vi.fn();

function handler() {
  const db = {
    insert: () => ({ values: insertValues }),
  } as unknown as Database;
  const router = createRegisterRouter(db);
  const layer = router.stack.find((l) => l.route?.path === "/oauth/register");
  return layer!.route!.stack[0].handle as (
    req: Request,
    res: Response
  ) => Promise<void>;
}

function mockRes() {
  const res = {
    status: vi.fn(() => res),
    json: vi.fn(() => res),
  };
  return res as unknown as Response & {
    status: ReturnType<typeof vi.fn>;
    json: ReturnType<typeof vi.fn>;
  };
}

describe("POST /oauth/register", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValues.mockResolvedValue(undefined);
  });

  it("registers a public client (token_endpoint_auth_method='none')", async () => {
    const res = mockRes();
    await handler()(
      { body: { redirect_uris: ["https://client.example/cb"] } } as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(201);
    const body = res.json.mock.calls[0][0];
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(typeof body.client_id).toBe("string");
    expect(body.client_id.length).toBeGreaterThan(0);
    // Never persists a confidential method.
    expect(insertValues.mock.calls[0][0].tokenEndpointAuthMethod).toBe("none");
  });

  it("downgrades a requested client_secret_post to public 'none'", async () => {
    const res = mockRes();
    await handler()(
      {
        body: {
          redirect_uris: ["https://client.example/cb"],
          token_endpoint_auth_method: "client_secret_post",
        },
      } as Request,
      res
    );

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json.mock.calls[0][0].token_endpoint_auth_method).toBe("none");
    expect(insertValues.mock.calls[0][0].tokenEndpointAuthMethod).toBe("none");
  });

  it("400s when redirect_uris is missing", async () => {
    const res = mockRes();
    await handler()({ body: {} } as Request, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(insertValues).not.toHaveBeenCalled();
  });
});

/* SCRUM-373: what a client may register as a redirect URI. The code is sent
 * wherever the client registered, so every refused shape is refused before a
 * row is written. */
describe("POST /oauth/register redirect URI rules (SCRUM-373)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValues.mockResolvedValue(undefined);
  });

  async function register(body: Record<string, unknown>) {
    const res = mockRes();
    await handler()({ body } as Request, res);
    return res;
  }

  it.each([
    ["not an array", "https://client.example/cb"],
    ["a non-string element", [42]],
    ["six URIs", Array.from({ length: 6 }, (_, i) => `https://client.example/cb${i}`)],
    ["a 513-character URI", [`https://client.example/${"a".repeat(513 - "https://client.example/".length)}`]],
    ["javascript:", ["javascript:alert(1)"]],
    ["a custom scheme", ["myapp://callback"]],
    ["http on a non-loopback host", ["http://client.example/cb"]],
    ["a fragment", ["https://client.example/cb#frag"]],
    ["an empty fragment", ["https://client.example/cb#"]],
    ["userinfo", ["https://user:pass@client.example/cb"]],
    ["a user name alone", ["https://attacker@client.example/cb"]],
  ])("refuses %s, and writes nothing", async (_name, redirect_uris) => {
    const res = await register({ redirect_uris });
    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json.mock.calls[0][0].error).toBe("invalid_redirect_uri");
    expect(insertValues).not.toHaveBeenCalled();
  });

  it.each([
    ["https", "https://claude.ai/api/mcp/auth_callback"],
    ["http on localhost with a port", "http://localhost:33418/callback"],
    ["http on 127.0.0.1 with a port", "http://127.0.0.1:8080/cb"],
    ["http on [::1] with a port", "http://[::1]:5000/cb"],
  ])("accepts %s", async (_name, uri) => {
    const res = await register({ redirect_uris: [uri] });
    expect(res.status).toHaveBeenCalledWith(201);
    expect(insertValues.mock.calls[0][0].redirectUris).toEqual([uri]);
  });

  it("accepts five URIs of 512 characters each, the limits themselves", async () => {
    const base = "https://client.example/";
    const uris = Array.from({ length: 5 }, (_, i) => `${base}${String(i)}${"a".repeat(512 - base.length - 1)}`);
    expect(uris.every((u) => u.length === 512)).toBe(true);
    const res = await register({ redirect_uris: uris });
    expect(res.status).toHaveBeenCalledWith(201);
  });

  it("stores client_name cleaned of control characters and capped at 100", async () => {
    await register({ redirect_uris: ["https://client.example/cb"], client_name: `Claude\n‮Code${"x".repeat(200)}` });
    const stored = insertValues.mock.calls[0][0].clientName as string;
    expect(stored.startsWith("Claude Code")).toBe(true);
    expect([...stored].length).toBe(100);
    expect(stored).not.toMatch(/[\n‮]/);
  });
});
