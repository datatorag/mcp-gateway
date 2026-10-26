import { describe, expect, it } from "vitest";
import { DUPLICATE_COPY, renderConnectDuplicate } from "./connect-duplicate";

const page = (over: Partial<Parameters<typeof renderConnectDuplicate>[0]> = {}) =>
  renderConnectDuplicate({
    provider: "google-workspace",
    maskedSignIn: "j•••@example.com",
    backHref: "/dashboard?connect_error=connected_elsewhere",
    next: null,
    ...over,
  });

describe("the duplicate-account page (SCRUM-363)", () => {
  it("names the other account only by the masked address it was given", () => {
    const html = page();
    expect(html).toContain("connected to another DataToRAG account (j•••@example.com).");
    expect(html).toContain("This Google account is already connected");
    expect(page({ provider: "notion" })).toContain("This Notion workspace is already connected");
  });

  it("offers both choices as form POSTs, never as links", () => {
    const html = page({ next: "/dashboard/agent?thread=t1" });
    expect(html).toMatch(/<form method="post" action="\/auth\/connect\/switch-account">/);
    expect(html).toContain('action="/auth/connect/anyway?provider=google-workspace&amp;next=%2Fdashboard%2Fagent%3Fthread%3Dt1"');
    expect(html).not.toMatch(/<a [^>]*href="\/auth\/connect\//);
  });

  it("escapes everything it is handed", () => {
    const html = page({ maskedSignIn: '<img src=x>"', backHref: '"><script>' });
    expect(html).not.toContain("<img src=x>");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x&gt;&quot;");
  });

  it("uses no dashes in its words", () => {
    const words = JSON.stringify(DUPLICATE_COPY) + DUPLICATE_COPY.title("Google account", "a•••@b.c");
    expect(words).not.toMatch(/[\u2013\u2014]/);
  });
});
