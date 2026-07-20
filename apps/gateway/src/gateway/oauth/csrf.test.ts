import { describe, it, expect } from "vitest";
import {
  nonceMatches,
  OAUTH_STATE_TTL_SECONDS,
  OAUTH_STATE_TTL_MS,
} from "./csrf";

describe("nonceMatches", () => {
  it("is true only when both nonces are present and equal", () => {
    expect(nonceMatches("abc123def456", "abc123def456")).toBe(true);
  });

  it("is false when the nonces differ", () => {
    expect(nonceMatches("abc123def456", "abc123def457")).toBe(false);
  });

  it("is false when either side is missing or empty", () => {
    expect(nonceMatches(undefined, "abc")).toBe(false);
    expect(nonceMatches("abc", undefined)).toBe(false);
    expect(nonceMatches("", "")).toBe(false);
    expect(nonceMatches(undefined, undefined)).toBe(false);
  });
});

describe("OAUTH_STATE_TTL", () => {
  it("keeps the ms and seconds constants in lockstep", () => {
    expect(OAUTH_STATE_TTL_MS).toBe(OAUTH_STATE_TTL_SECONDS * 1000);
  });
});
