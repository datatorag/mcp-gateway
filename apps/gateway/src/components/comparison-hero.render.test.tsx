// @vitest-environment jsdom

/**
 * The comparison hero: every row we have that Anthropic's help page does not
 * describe, at once, from the first paint, with one reveal that a reader who
 * asked for less motion never gets.
 * Rendered to markup the way the server sends it.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparisonHero } from "./comparison-hero";
import { GROUPS, heroGroups } from "./connector-comparison";
import { BUILT_IN_CHECKED_ON } from "@/lib/connector-verification";

const html = renderToStaticMarkup(<ComparisonHero groups={heroGroups()} checkedOn={BUILT_IN_CHECKED_ON} />);
const doc = new DOMParser().parseFromString(html, "text/html");
/** The gap rows; the one muted "Both:" line per group is a tie row. */
const rows = () => [...doc.querySelectorAll('tbody tr:not([data-tie]) th[scope="row"]')].map((th) => th.closest("tr")!);
const ties = () => [...doc.querySelectorAll("tbody tr[data-tie]")];

describe("the comparison hero", () => {
  it("renders every gap at once, under every group heading", () => {
    const groups = heroGroups();
    const total = groups.reduce((n, g) => n + g.rows.length, 0);
    expect(total).toBe(6);
    expect(rows()).toHaveLength(total);
    expect([...doc.querySelectorAll('th[scope="colgroup"]')].map((th) => th.textContent)).toEqual(groups.map((g) => g.label));
    for (const g of groups) {
      for (const r of g.rows) expect(html, r.capability).toContain(r.capability);
    }
  });

  it("every row reads Not described, then Yes, and never No; the only Yes/Yes rows are the Both lines", () => {
    // A built-in cell says what the vendor's page does not describe. It does
    // not say No: the page being silent is not Anthropic stating a limit.
    for (const tr of rows()) {
      const [builtIn, ours] = [...tr.querySelectorAll("td")].map((td) => td.textContent);
      expect(builtIn, tr.textContent!).toBe("Not described on Anthropic's help page");
      expect(ours, tr.textContent!).toBe("Yes");
    }
    expect([...doc.querySelectorAll("td .sr-only")].map((s) => s.textContent)).not.toContain("No");
    const groups = heroGroups();
    expect(ties()).toHaveLength(groups.filter((g) => g.ties.length > 0).length);
    for (const tr of ties()) {
      expect(tr.querySelector("th")!.textContent!.startsWith("Both: "), tr.textContent!).toBe(true);
      expect([...tr.querySelectorAll(".sr-only")].map((s) => s.textContent)).toEqual(["Yes", "Yes"]);
    }
  });

  it("names no row the built-in connectors win, anywhere", () => {
    const losses = GROUPS.flatMap((g) => g.rows).filter((r) => r.builtIn && !r.ours);
    expect(losses.length).toBeGreaterThan(0);
    for (const r of losses) expect(html, r.capability).not.toContain(r.capability);
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

  it("names the vendor page's date once, says what Not described means, and links to the full table", () => {
    const link = doc.querySelector<HTMLAnchorElement>('a[href="#comparison"]')!;
    expect(link.textContent).toContain(`Anthropic\u2019s help page as of ${BUILT_IN_CHECKED_ON}`);
    expect(link.textContent).toContain("not that Claude cannot do it");
    expect(doc.querySelector("caption")!.textContent).toContain(`as of ${BUILT_IN_CHECKED_ON}`);
    // The page passes the one constant, not a date of its own.
    const page = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");
    expect(page).toContain("checkedOn={BUILT_IN_CHECKED_ON}");
  });

  it("on the landing page follows the wheel hero directly, with the tool count line beside it", () => {
    // The wheel took the top of the page; the comparison is the next thing
    // on it, before the demo, on the hero's own dark ground.
    const page = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");
    const at = (needle: string) => {
      const i = page.indexOf(needle);
      expect(i, needle).toBeGreaterThan(-1);
      return i;
    };
    const hero = page.slice(at("{/* Hero"), at("</ShaderBackground>"));
    expect(hero).toContain("<HomeHero");
    expect(hero).toContain("<TrustedBy");
    expect(hero).not.toContain("<ComparisonHero");
    const band = page.slice(at("</ShaderBackground>"), at('id="playground"'));
    expect(band).toContain("<ComparisonHero");
    expect(band).toContain("{PUBLIC_CONNECTORS_TEXT} behind one URL, in Claude, Claude");
    // Nothing sits between the hero and the comparison's section.
    expect(band.slice(0, band.indexOf("<section")).replace(/\{\/\*[\s\S]*?\*\/\}/g, "").trim()).toBe("</ShaderBackground>");
    // The agreement line left the hero on Manuel's word; it is shown on the
    // first screen after sign-in instead (agent-empty-state.test.tsx).
    expect(page).not.toContain("<SignInConsent");
    // The page has one h1, and it is the hero's (home-hero.render.test.tsx).
    expect(page).not.toContain("<h1");
    // No connector we do not ship is named anywhere on the page (SCRUM-426).
    for (const name of ["Salesforce", "Databricks", "Slack", "HubSpot", "PostgreSQL", "Snowflake"]) {
      expect(page, name).not.toContain(name);
    }
    // The "Coming soon" list held only Notion, which shipped (SCRUM-366), so
    // the block is gone; a connector that comes back here needs a ticket.
    expect(page).not.toContain("Coming soon connectors");
    expect(page).not.toMatch(/>\s*Coming soon\s*</);
    // The pill above the headline is gone, and so is the old long sentence.
    expect(page).not.toContain("MCP gateway for Google Workspace and Jira");
    expect(page).not.toContain("File the email on the Jira issue");
  });
});
