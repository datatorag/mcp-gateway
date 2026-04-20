import { describe, it, expect } from "vitest";
import { redactErrorMessage } from "./redact";

describe("redactErrorMessage", () => {
  it("returns null for null input", () => {
    expect(redactErrorMessage(null)).toBeNull();
  });

  it("returns empty string unchanged", () => {
    expect(redactErrorMessage("")).toBe("");
  });

  it("masks email addresses", () => {
    const input = "failed to send to alice@example.com and bob.smith+tag@acme.co";
    const out = redactErrorMessage(input);
    expect(out).not.toContain("alice@example.com");
    expect(out).not.toContain("bob.smith+tag@acme.co");
    expect(out).toContain("[redacted-email]");
  });

  it("masks Google Drive file IDs", () => {
    const input = "file 1BxABcDeFgHiJkLmNoPqRsTuVwXyZ01234 not found";
    const out = redactErrorMessage(input);
    expect(out).not.toContain("1BxABcDeFgHiJkLmNoPqRsTuVwXyZ01234");
    expect(out).toContain("[redacted-id]");
  });

  it("masks Google Doc URL IDs", () => {
    const input =
      "https://docs.google.com/document/d/1BxABcDeFgHi_jkLmNoPqRsTuVwXyZ/edit";
    const out = redactErrorMessage(input);
    expect(out).not.toContain("1BxABcDeFgHi_jkLmNoPqRsTuVwXyZ");
  });

  it("masks Calendar event IDs", () => {
    const input = "event abc123def456ghi789jkl012 does not exist";
    const out = redactErrorMessage(input);
    expect(out).not.toContain("abc123def456ghi789jkl012");
  });

  it("masks quoted strings longer than 40 chars", () => {
    const input =
      'subject was "The quick brown fox jumps over the lazy dog today"';
    const out = redactErrorMessage(input);
    expect(out).not.toContain("The quick brown fox jumps over the lazy dog today");
    expect(out).toContain('"[redacted-content]"');
  });

  it("keeps short quoted strings", () => {
    const input = 'field "title" is required';
    const out = redactErrorMessage(input);
    expect(out).toContain('"title"');
  });

  it("truncates long outputs to 500 chars", () => {
    const input = "x".repeat(2000);
    const out = redactErrorMessage(input);
    expect(out!.length).toBeLessThanOrEqual(500);
  });
});
