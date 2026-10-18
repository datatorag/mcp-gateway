// @vitest-environment jsdom

/**
 * The comparison hero (SCRUM-426): every gap at once, from the first paint,
 * with one reveal that a reader who asked for less motion never gets.
 * Rendered to markup the way the server sends it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparisonHero } from "./comparison-hero";
import { heroGroups } from "./connector-comparison";

const html = renderToStaticMarkup(
  <ComparisonHero groups={heroGroups()} verifiedOn="15 October 2026" slidesVerifiedOn="9 October 2026" />
);
const doc = new DOMParser().parseFromString(html, "text/html");
const rows = () => [...doc.querySelectorAll('tbody th[scope="row"]')].map((th) => th.closest("tr")!);

describe("the comparison hero", () => {
  it("renders every gap at once, under every group heading", () => {
    const groups = heroGroups();
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(9);
    expect(rows()).toHaveLength(total);
    expect([...doc.querySelectorAll('th[scope="colgroup"]')].map((th) => th.textContent)).toEqual(groups.map((g) => g.label));
    for (const g of groups) {
      for (const r of g.rows) expect(html, r.capability).toContain(r.capability);
    }
  });

  it("holds no Yes/Yes row: every row reads No, then Yes", () => {
    for (const tr of rows()) {
      expect([...tr.querySelectorAll(".sr-only")].map((s) => s.textContent), tr.textContent!).toEqual(["No", "Yes"]);
    }
  });

  it("is final in the markup itself, so reduced motion shows the finished table", () => {
    // No state, no placeholder marks, nothing for a script to resolve: the
    // only motion is the hero-reveal class, which exists only when the reader
    // has not asked for less motion.
    expect(html).not.toContain("rounded-full bg-white/30");
    expect(doc.querySelectorAll("button")).toHaveLength(0);
    for (const tr of rows()) expect(tr.classList.contains("hero-reveal")).toBe(true);
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    const rule = css.indexOf(".hero-reveal");
    expect(rule).toBeGreaterThan(-1);
    const media = css.lastIndexOf("@media", rule);
    expect(css.slice(media, rule)).toContain("(prefers-reduced-motion: no-preference)");
    // And it is the only place the class is defined.
    expect(css.indexOf(".hero-reveal", rule + 1)).toBe(-1);
  });

  it("reveals in order, within about a second and a quarter", () => {
    const delays = [...doc.querySelectorAll<HTMLElement>(".hero-reveal")].map((el) => parseFloat(el.style.animationDelay));
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(Math.max(...delays)).toBeLessThanOrEqual(1);
  });

  it("names both dates, because a Slides row is in it, and links to the full table", () => {
    const link = doc.querySelector<HTMLAnchorElement>('a[href="#comparison"]')!;
    expect(link.textContent).toContain("15 October 2026");
    expect(link.textContent).toContain("Google Slides on 9 October 2026");
  });

  it("on the landing page comes right after the headline, before the sentence and the buttons", () => {
    // The DOM order is the phone order (the grid moves it beside the text
    // from lg). Measured in the browser too: see the SCRUM-426 report.
    const page = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");
    const hero = page.slice(page.indexOf("{/* Hero */}"), page.indexOf("</ShaderBackground>"));
    const at = (needle: string) => {
      const i = hero.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    expect(at("<h1")).toBeLessThan(at("<ComparisonHero"));
    expect(at("<ComparisonHero")).toBeLessThan(at("behind one URL, and every write"));
    expect(at("<ComparisonHero")).toBeLessThan(at("Get Started"));
    expect(at("Get Started")).toBeLessThan(at("<SignInConsent"));
    // The headline is the simpler one, with its second sentence on a line
    // of its own (SCRUM-426).
    const h1 = hero.slice(at("<h1"), hero.indexOf("</h1>"));
    expect(h1).toContain("One connection to Google Workspace and Jira.");
    // Its own line from sm up; on a phone it flows on, so the table sits higher.
    expect(h1).toMatch(/className="text-blue-200 sm:block"/);
    expect(h1).not.toMatch(/className="[^"]*(?<![:\w-])block[\s"]/);
    expect(h1).toContain("Claude moves the work");
    expect(h1).not.toContain("Gmail, Drive, Sheets");
    // No connector we do not ship is named anywhere on the page (SCRUM-426).
    for (const name of ["Salesforce", "Databricks", "Slack"]) expect(page, name).not.toContain(name);
    // The pill above the headline is gone, and so is the long sentence.
    expect(hero).not.toContain("MCP gateway for Google Workspace and Jira");
    expect(hero).not.toContain("Claude Code, Cursor");
  });
});
