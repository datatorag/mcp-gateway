/**
 * SCRUM-466: the session a connect link mints is the one the Google sign-in
 * mints, from one function. Pinned field by field so the two cannot drift.
 */
import { describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { hashToken } from "@datatorag-mcp/auth";
import { createWebSession, WEB_SESSION_CLIENT_ID, WEB_SESSION_TTL_MS } from "./web-session";

describe("createWebSession", () => {
  it("stores a hashed web session for the user and sets the cookie with the same token", async () => {
    const values = vi.fn(async () => undefined);
    const db = { insert: () => ({ values }) } as unknown as Database;
    const cookie = vi.fn();
    const before = Date.now();

    await createWebSession(db, { cookie } as never, "user-1");

    const row = (values.mock.calls[0] as unknown as [Record<string, unknown>])[0];
    const [name, token, opts] = cookie.mock.calls[0] as [string, string, Record<string, unknown>];
    expect(name).toBe("dtrmcp_session");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(row).toMatchObject({
      token,
      tokenHash: hashToken(token),
      clientId: WEB_SESSION_CLIENT_ID,
      userId: "user-1",
      scope: null,
    });
    const expires = (row.expiresAt as Date).getTime();
    expect(expires).toBeGreaterThanOrEqual(before + WEB_SESSION_TTL_MS);
    expect(expires).toBeLessThanOrEqual(Date.now() + WEB_SESSION_TTL_MS);
    expect(opts).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      expires: row.expiresAt,
    });
  });
});
