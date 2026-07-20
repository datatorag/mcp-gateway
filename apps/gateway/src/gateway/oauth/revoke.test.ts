import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Request, Response } from "express";
import type { Database } from "@datatorag-mcp/db";
import { oauthAccessTokens, oauthRefreshTokens } from "@datatorag-mcp/db";

// SEC-3: revoking a refresh token must also revoke the family's live access
// tokens (otherwise a revoked client keeps a working bearer for up to 24h).

vi.mock("../../lib/posthog-server", () => ({
  getPosthog: () => null,
}));

import { createRevokeRouter } from "./revoke";

type UpdateSpy = ReturnType<typeof vi.fn>;

function build(row: Record<string, unknown> | undefined) {
  const update: UpdateSpy = vi.fn(() => ({
    set: () => ({ where: vi.fn().mockResolvedValue(undefined) }),
  }));
  const tx = {
    select: () => ({
      from: () => ({
        where: () => ({
          for: () => ({ limit: () => Promise.resolve(row ? [row] : []) }),
        }),
      }),
    }),
    update,
  };
  const db = {
    transaction: (cb: (tx: unknown) => Promise<unknown>) => cb(tx),
  } as unknown as Database;

  const router = createRevokeRouter(db);
  const layer = router.stack.find(
    (l) => l.route?.path === "/oauth/revoke"
  );
  const handler = layer!.route!.stack[0].handle as (
    req: Request,
    res: Response
  ) => Promise<void>;
  return { handler, update };
}

function mockRes() {
  const res = {
    status: vi.fn(() => res),
    send: vi.fn(() => res),
  };
  return res as unknown as Response & { status: UpdateSpy; send: UpdateSpy };
}

const liveRow = {
  userId: "user-1",
  clientId: "mcp-client-1",
  familyId: "fam-1",
  revokedAt: null,
};

describe("POST /oauth/revoke", () => {
  beforeEach(() => vi.clearAllMocks());

  it("revokes both refresh tokens AND access tokens for the grant", async () => {
    const { handler, update } = build(liveRow);
    const res = mockRes();
    await handler(
      { body: { token: "raw-refresh", client_id: "mcp-client-1" } } as Request,
      res
    );

    const updatedTables = update.mock.calls.map((c) => c[0]);
    expect(updatedTables).toContain(oauthRefreshTokens);
    expect(updatedTables).toContain(oauthAccessTokens);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("does nothing when the client_id doesn't match the token's grant", async () => {
    const { handler, update } = build(liveRow);
    const res = mockRes();
    await handler(
      { body: { token: "raw-refresh", client_id: "someone-else" } } as Request,
      res
    );
    // Mismatched client → early return, no revocation of either table.
    expect(update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it("200s without touching the DB on a malformed request", async () => {
    const { handler, update } = build(liveRow);
    const res = mockRes();
    await handler({ body: { token: "" } } as Request, res);
    expect(update).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
