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
