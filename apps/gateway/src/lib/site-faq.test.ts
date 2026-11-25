/**
 * Two answers the site gives in more than one place, pinned to one source.
 *
 * Both are fixed strings, which is the kind of claim a test can hold. Whether
 * the sentences are TRUE is not something this file can know: the self-hosting
 * sentence rests on the repository's LICENSE file, and the built-in connector
 * sentence on Anthropic's help page as read on BUILT_IN_CHECKED_ON. What this
 * pins is that no surface answers the same question in words of its own.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BUILT_IN_CHECKED_ON,
  BUILT_IN_DIFFERENCE,
  BUILT_IN_HELP_URL,
  SELF_HOSTING,
  SITE_FAQ_PAGES,
  siteFaqs,
} from "./site-faq";

const all = SITE_FAQ_PAGES.flatMap((p) => p.groups.flatMap((g) => g.faqs.map((f) => ({ route: p.route, ...f }))));
const landing = readFileSync(
  join(__dirname, "../app/hosted-google-workspace-mcp/page.tsx"),
  "utf8"
);

/** Any wording that tells a reader they can run the gateway themselves. */
const RUN_IT_YOURSELF = /self-host|run it yourself|running it yourself|run by you/i;

describe("the self-hosting answer", () => {
  it("is the license the repository actually carries", () => {
    const license = readFileSync(join(__dirname, "../../../../LICENSE"), "utf8");
    expect(license.startsWith("MIT License")).toBe(true);
    expect(SELF_HOSTING).toContain("MIT-licensed");
  });

  it("says what a person has to supply, and that there is no guide", () => {
    for (const part of [
      "It is not one command",
      "no packaged self-host guide yet",
      "a Postgres database",
      "your own Google OAuth clients",
      "an encryption key for the stored tokens",
    ]) {
      expect(SELF_HOSTING).toContain(part);
    }
  });

  it("is the sentence every FAQ answer about running it yourself uses", () => {
    const mentioning = all.filter((f) => RUN_IT_YOURSELF.test(f.a));
    // Home, pricing, and the hosted page each answer it.
    expect(mentioning.map((f) => f.route).sort()).toEqual([
      "/",
      "/hosted-google-workspace-mcp",
      "/pricing",
    ]);
    for (const f of mentioning) {
      expect(f.a, `${f.route}: ${f.q}`).toContain(SELF_HOSTING);
    }
  });

  it("the rule can go red", () => {
    const old = "Yes. The DataToRAG gateway is open source and you can self-host it.";
    expect(RUN_IT_YOURSELF.test(old) && !old.includes(SELF_HOSTING)).toBe(true);
  });

  it("is what the hosted landing page renders, with no line of its own offering it", () => {
    expect(landing).toContain("{SELF_HOSTING}");
    expect(landing).not.toMatch(/self-host it if you prefer/i);
    expect(landing).not.toMatch(/Self-host if that trade/);
  });
});

describe("the difference from Claude's built-in Google connectors", () => {
  it("is asked and answered on /faq and on the hosted landing page", () => {
    for (const route of ["/faq", "/hosted-google-workspace-mcp"]) {
      const faq = siteFaqs(route).find((f) => f.q === BUILT_IN_DIFFERENCE.question);
      expect(faq, route).toBeDefined();
      expect(faq!.a).toContain(BUILT_IN_DIFFERENCE.ours);
      expect(faq!.a).toContain(`As of ${BUILT_IN_CHECKED_ON}`);
      expect(faq!.a).toContain(`](${BUILT_IN_HELP_URL})`);
    }
  });

  it("leads with DataToRAG and dates the sentence about the other product", () => {
    expect(BUILT_IN_DIFFERENCE.ours.startsWith("DataToRAG is")).toBe(true);
    expect(BUILT_IN_DIFFERENCE.theirsLead).toContain(BUILT_IN_CHECKED_ON);
    expect(BUILT_IN_CHECKED_ON).toMatch(/^[A-Z][a-z]+ \d{1,2}, 20\d{2}$/);
    expect(BUILT_IN_HELP_URL.startsWith("https://support.claude.com/")).toBe(true);
  });

  it("opens the landing page, above the paragraph that used to open it", () => {
    const answer = landing.indexOf("{BUILT_IN_DIFFERENCE.ours}");
    const oldOpening = landing.indexOf("Add one endpoint, sign in with Google");
    expect(answer).toBeGreaterThan(landing.indexOf("<h1"));
    expect(answer).toBeLessThan(oldOpening);
  });

  it("fits the answer in the page's first hundred words", () => {
    const words = (s: string) => s.trim().split(/\s+/).length;
    const opening =
      words("Hosted MCP A hosted Google Workspace MCP, with write access") +
      words(BUILT_IN_DIFFERENCE.ours) +
      words(BUILT_IN_DIFFERENCE.theirsLead) +
      words(BUILT_IN_DIFFERENCE.theirsSource) +
      words(BUILT_IN_DIFFERENCE.theirsRest);
    expect(opening).toBeLessThanOrEqual(100);
  });
});

describe("copy rules on the shared strings", () => {
  it("no em or en dash", () => {
    for (const s of [SELF_HOSTING, ...Object.values(BUILT_IN_DIFFERENCE)]) {
      expect(s).not.toMatch(/[–—]/);
    }
  });
});
