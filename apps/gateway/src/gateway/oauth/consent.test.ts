/** SCRUM-373: the consent page's words, and what it shows of the client. */
import { describe, expect, it } from "vitest";
import { CONSENT_COPY, redirectHost, renderConsentPage } from "./consent";

const PENDING = "00000000-0000-4000-8000-000000000000";

describe("the consent page", () => {
  it("escapes the client name", () => {
    const html = renderConsentPage({
      clientName: '<script>alert("x")</script>',
      email: "a@example.com",
      redirectUri: "https://client.example/cb",
      pendingId: PENDING,
    });
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;");
  });

  it("shows the redirect host only, never the path or query", () => {
    const html = renderConsentPage({
      clientName: "Claude",
      email: "a@example.com",
      redirectUri: "https://claude.ai/api/mcp/auth_callback?x=secret-looking",
      pendingId: PENDING,
    });
    expect(html).toContain("<strong>claude.ai</strong>");
    expect(html).not.toContain("auth_callback");
    expect(html).not.toContain("secret-looking");
  });

  it("shows an internationalised host in its punycode form", () => {
    expect(redirectHost("https://bücher.example/cb")).toBe("xn--bcher-kva.example");
    const html = renderConsentPage({
      clientName: "Claude",
      email: "a@example.com",
      redirectUri: "https://bücher.example/cb",
      pendingId: PENDING,
    });
    expect(html).toContain("xn--bcher-kva.example");
    expect(html).not.toContain("bücher");
  });

  it("reads 'an app' when the client sent no name", () => {
    const html = renderConsentPage({ clientName: null, email: "a@example.com", redirectUri: "http://localhost:3000/cb", pendingId: PENDING });
    expect(html).toContain("Allow an app to use DataToRAG?");
    expect(html).toContain("This app will be able to use the tools");
  });

  it("has no em or en dashes in any of its words", () => {
    const words = Object.values(CONSENT_COPY).map((v) => (typeof v === "function" ? v("Claude", "a@example.com") : v));
    for (const w of words) expect(w).not.toMatch(/[\u2013\u2014]/);
  });
});
