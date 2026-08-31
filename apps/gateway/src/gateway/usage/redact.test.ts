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

  /* SCRUM-176: the matched pair. The blanket quoted-string rule could not
   * tell an API's own diagnostic from user data, because a JSON envelope
   * quotes everything: every Google error message over 40 characters was
   * destroyed by construction, and the one-directional "secrets are gone"
   * check stayed green the whole time. These two tests hold BOTH directions:
   * the diagnostic survives, the content still dies. */

  it("keeps a real Google 400 diagnostic intact (SCRUM-176)", () => {
    // Verbatim envelope shape; message well over 40 characters. On the old
    // code this became "[redacted-content]" and the row was undiagnosable.
    const input =
      'Error: API error: {"error":{"code":400,"message":"Invalid requests[0].replaceAllText: replacement text parameter is required but not specified.","reason":"badRequest"}}';
    const out = redactErrorMessage(input);
    expect(out).toContain(
      "Invalid requests[0].replaceAllText: replacement text parameter is required but not specified."
    );
    expect(out).toContain('"code":400');
    expect(out).toContain('"reason":"badRequest"');
  });

  it("still destroys document text carried inside a diagnostic (SCRUM-176)", () => {
    // A message that embeds a quoted run of user content: the envelope is
    // recognised, the diagnostic prose survives, the quoted content does not.
    const input =
      "Error: API error: {\"error\":{\"code\":400,\"message\":\"Invalid replacement text 'the entire confidential quarterly board memo pasted here as one string' in request\",\"reason\":\"badRequest\"}}";
    const out = redactErrorMessage(input);
    expect(out).not.toContain("confidential quarterly board memo");
    expect(out).toContain("[redacted-content]");
    expect(out).toContain('"code":400');
  });

  it("drops fields that are not on the diagnostic allowlist (SCRUM-176)", () => {
    const input =
      'Error: API error: {"error":{"code":400,"message":"Bad request parameter for the requested operation value.","documentBody":"forty-plus characters of raw user document text right here"}}';
    const out = redactErrorMessage(input);
    expect(out).not.toContain("raw user document text");
    expect(out).not.toContain("documentBody");
  });

  it("falls back to the blanket rule when the envelope does not parse (SCRUM-176)", () => {
    // Truncated JSON (quotes closed, braces missing): unparseable, so the
    // blanket behavior applies unchanged and the long quoted run is
    // destroyed. Unrecognised shapes fail closed.
    const input =
      'Error: API error: {"error":{"code":400,"message":"a diagnostic string comfortably past the forty character mark","reason":"badRe';
    const out = redactErrorMessage(input);
    expect(out).not.toContain("comfortably past the forty character mark");
    expect(out).toContain("[redacted-content]");
  });

  it("still redacts an email inside a kept diagnostic (SCRUM-176)", () => {
    const input =
      'Error: API error: {"error":{"code":403,"message":"The caller alice@example.com does not have permission to access this resource.","reason":"forbidden"}}';
    const out = redactErrorMessage(input);
    expect(out).not.toContain("alice@example.com");
    expect(out).toContain("[redacted-email]");
    expect(out).toContain("does not have permission");
  });

  it("still redacts a long id inside a kept diagnostic (SCRUM-176)", () => {
    const input =
      'Error: API error: {"error":{"code":404,"message":"Requested entity 1BxABcDeFgHiJkLmNoPqRsTuVwXyZ01234 was not found on the server.","reason":"notFound"}}';
    const out = redactErrorMessage(input);
    expect(out).not.toContain("1BxABcDeFgHiJkLmNoPqRsTuVwXyZ01234");
    expect(out).toContain("[redacted-id]");
    expect(out).toContain("was not found");
  });
});
