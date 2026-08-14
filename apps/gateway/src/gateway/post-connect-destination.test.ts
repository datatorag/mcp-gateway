import { describe, expect, it } from "vitest";
import { postConnectDestination } from "./post-connect-destination";

/**
 * Where a connect round trip lands. The validation cases mirror the login
 * `next` suite on purpose: it is the same open-redirect surface, and each
 * rejected form is pinned by name so a "simplification" that drops one goes
 * red instead of quiet.
 */
describe("postConnectDestination", () => {
  it("returns to the requested path with connected=<provider>", () => {
    expect(
      postConnectDestination({
        requestedPath: "/dashboard/agent?thread=t-1",
        provider: "google-workspace",
      })
    ).toBe("/dashboard/agent?thread=t-1&connected=google-workspace");
  });

  it("returns to the requested path with connect_error=<code> on failure", () => {
    expect(
      postConnectDestination({
        requestedPath: "/dashboard/agent?thread=t-1",
        error: "token_exchange_failed",
      })
    ).toBe("/dashboard/agent?thread=t-1&connect_error=token_exchange_failed");
  });

  it("falls back to the connections page when no path was requested", () => {
    // Byte-identical to the destinations the flow had before SCRUM-78.
    expect(postConnectDestination({ provider: "atlassian" })).toBe(
      "/dashboard/connections?connected=atlassian"
    );
    expect(postConnectDestination({ error: "missing_code" })).toBe(
      "/dashboard/connections?error=missing_code"
    );
  });

  it("strips a connected/connect_error the requested path smuggled in", () => {
    // The client auto-continues the conversation off `connected`, so a next
    // that carries its own must not fake a completion the flow did not make.
    expect(
      postConnectDestination({
        requestedPath: "/dashboard/agent?connected=google-workspace",
        error: "missing_code",
      })
    ).toBe("/dashboard/agent?connect_error=missing_code");
  });

  it("rejects an absolute URL", () => {
    expect(
      postConnectDestination({
        requestedPath: "https://evil.example/phish",
        provider: "google-workspace",
      })
    ).toBe("/dashboard/connections?connected=google-workspace");
  });

  it("rejects a protocol-relative path", () => {
    expect(
      postConnectDestination({
        requestedPath: "//evil.example",
        provider: "google-workspace",
      })
    ).toBe("/dashboard/connections?connected=google-workspace");
  });

  it("rejects a backslash variant", () => {
    expect(
      postConnectDestination({
        requestedPath: "/\\evil.example",
        provider: "google-workspace",
      })
    ).toBe("/dashboard/connections?connected=google-workspace");
  });

  it("rejects an encoded-slash double-decoding trick", () => {
    expect(
      postConnectDestination({
        requestedPath: "/%2f%2fevil.example",
        provider: "google-workspace",
      })
    ).toBe("/dashboard/connections?connected=google-workspace");
  });

  it("rejects a dot-segment path whose COMPOSED form escapes origin", () => {
    // `/..//evil.example` passes the raw checks (single leading slash), but
    // WHATWG normalisation collapses the dot segment into a protocol-relative
    // `//evil.example`. The output re-validation is what catches it.
    expect(
      postConnectDestination({
        requestedPath: "/..//evil.example",
        provider: "google-workspace",
      })
    ).toBe("/dashboard/connections?connected=google-workspace");
  });

  it("rejects a non-string and an oversized value", () => {
    expect(
      postConnectDestination({ requestedPath: 42, provider: "atlassian" })
    ).toBe("/dashboard/connections?connected=atlassian");
    expect(
      postConnectDestination({
        requestedPath: `/${"a".repeat(600)}`,
        provider: "atlassian",
      })
    ).toBe("/dashboard/connections?connected=atlassian");
  });
});
