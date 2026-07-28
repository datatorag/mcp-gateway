import { describe, expect, it } from "vitest";
import { isTokenLive } from "./token-liveness";

// isTokenLive must mirror liveTokenConditions (same file) exactly: not
// revoked, and either no expiry or expiry in the future.
describe("isTokenLive", () => {
  const future = new Date(Date.now() + 60_000);
  const past = new Date(Date.now() - 60_000);

  it("accepts an unrevoked, unexpired token", () => {
    expect(isTokenLive({ revokedAt: null, expiresAt: future })).toBe(true);
  });

  it("accepts a token with no expiry", () => {
    expect(isTokenLive({ revokedAt: null, expiresAt: null })).toBe(true);
  });

  it("rejects revoked, even with future expiry", () => {
    expect(isTokenLive({ revokedAt: past, expiresAt: future })).toBe(false);
  });

  it("rejects expired", () => {
    expect(isTokenLive({ revokedAt: null, expiresAt: past })).toBe(false);
  });
});
