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
    // This is the canary half of the pair below — read them together.
    const input =
      "Error: API error: {\"error\":{\"code\":400,\"message\":\"Invalid replacement text 'the entire confidential quarterly board memo pasted here as one string' in request\",\"reason\":\"badRequest\"}}";
    const out = redactErrorMessage(input);
    expect(out).not.toContain("confidential quarterly board memo");
    expect(out).toContain("[redacted-content]");
    expect(out).toContain('"code":400');
  });

  it("lets an UNQUOTED short user-ish token inside a diagnostic survive — an accepted trade (SCRUM-176)", () => {
    // THE PIN FOR A DELIBERATE DECISION, not a hole. An unquoted value echoed
    // inside a recognised diagnostic message (here: a spreadsheet tab name in
    // a range-parse error) SURVIVES redaction. That is the accepted trade of
    // SCRUM-176: keeping the message field diagnosable and destroying every
    // unquoted fragment inside it are mutually exclusive, and the trade is
    // bounded — only allowlisted fields survive at all, provider-quoted
    // echoes still die (see the canary test above, its counterpart), emails
    // and long ids still die inside kept values, and output is capped.
    // If you are reading this because survival looks like a bug to close:
    // closing it silently reverts the diagnosability this ticket exists for,
    // with every other guard still green. Change it only with a ruling.
    const input =
      'Error: API error: {"error":{"code":400,"message":"Unable to parse range: MyProjects!A1:B2","reason":"badRequest"}}';
    const out = redactErrorMessage(input);
    expect(out).toContain("Unable to parse range: MyProjects!A1:B2");
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

/* SCRUM-245: an API key is a credential, and a credential quoted inside an
 * error (a client that pasted it into the wrong header, a proxy echoing the
 * request) must never reach the analytics vendor. */
describe("redactErrorMessage masks API keys (SCRUM-245)", () => {
  it("masks a key wherever it appears, keeping the rest of the diagnostic", () => {
    const out = redactErrorMessage("401 from upstream for bearer sk-dtrmcp_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_ab; retry");
    expect(out).not.toContain("sk-dtrmcp_");
    expect(out).toContain("401 from upstream for bearer ");
    expect(out).toContain("; retry");
  });

  it("masks a short or truncated key too, since a prefix is enough to match on", () => {
    expect(redactErrorMessage("saw sk-dtrmcp_abc here")).toBe("saw [redacted-key] here");
  });
});

/* SCRUM-366: Notion's error envelope types the two fields the other way
 * round from Google's: `status` is the HTTP number and `code` is a string
 * ("object_not_found"). The Google allowlist keeps a NUMBER code and a STRING
 * status, so a Notion envelope lost both and kept only the message. Its own
 * case keeps them, for that shape only. */
describe("redactErrorMessage keeps a Notion error envelope's code and status (SCRUM-366)", () => {
  const NOTION_404 =
    'Notion API error: {"object":"error","status":404,"code":"object_not_found","message":"Could not find page with ID: 0a1b2c3d-0000-4000-8000-00000000abcd. Make sure the relevant pages and databases are shared with your integration.","request_id":"5e6f7a8b-0000-4000-8000-000000000001"}';

  it("keeps code as a string and status as a number", () => {
    const out = redactErrorMessage(NOTION_404)!;
    const parsed = JSON.parse(out.slice(out.indexOf("{"), out.lastIndexOf("}") + 1)) as Record<string, unknown>;
    expect(parsed.object).toBe("error");
    expect(parsed.status).toBe(404);
    expect(parsed.code).toBe("object_not_found");
    expect(String(parsed.message)).toContain("Make sure the relevant pages and databases are shared");
  });

  it("keeps a long code whole, which the id pattern would otherwise mask", () => {
    const out = redactErrorMessage(
      '{"object":"error","status":500,"code":"internal_server_error","message":"Unexpected error occurred."}'
    )!;
    expect(out).toContain('"code":"internal_server_error"');
    expect(out).toContain('"status":500');
  });

  it("still scrubs the message and drops unknown fields", () => {
    const out = redactErrorMessage(NOTION_404)!;
    // The page id inside the message is masked by the usual patterns.
    expect(out).not.toContain("0a1b2c3d-0000-4000-8000-00000000abcd");
    // request_id is not a diagnostic we keep.
    expect(out).not.toContain("request_id");
  });

  it("drops a code that is not a plain snake_case word", () => {
    const out = redactErrorMessage(
      '{"object":"error","status":400,"code":"the user typed this whole sentence","message":"Bad."}'
    )!;
    expect(out).not.toContain("the user typed this whole sentence");
    expect(out).toContain('"status":400');
  });

  it("leaves Google's envelope exactly as before: a string code is still dropped there", () => {
    const google = 'Error: API error: {"error":{"code":400,"message":"Bad request.","status":"INVALID_ARGUMENT"}}';
    expect(redactErrorMessage(google)).toBe(
      'Error: API error: {"error":{"code":400,"message":"Bad request.","status":"INVALID_ARGUMENT"}}'
    );
    // A bare object WITHOUT object:"error" keeps the Google typing.
    const bare = '{"status":404,"code":"object_not_found","message":"Gone."}';
    const out = redactErrorMessage(bare)!;
    expect(out).not.toContain("object_not_found");
    expect(out).not.toContain("404");
    expect(out).toContain("Gone.");
  });
});
