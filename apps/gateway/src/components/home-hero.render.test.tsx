// @vitest-environment jsdom

/**
 * The home page's hero as the server sends it: the heading and the ask, the
 * wheel's tools as markup (the canvas is drawn later, in the browser), and
 * the "Trusted by" row.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HERO_HEADLINE, HERO_SUBTITLE, HomeHero } from "./home-hero";
import { TrustedBy } from "./trusted-by";
import { WHEEL_TOOLS } from "@/lib/home-wheel";
import { PUBLIC_SERVICES } from "@/lib/public-integrations";
import { TRUSTED_BY } from "@/lib/trusted-by";

const PUBLIC_DIR = join(import.meta.dirname, "../../public");
const DOCS_DIR = join(import.meta.dirname, "../../content/docs");
const parse = (html: string) => new DOMParser().parseFromString(html, "text/html");

const heroHtml = renderToStaticMarkup(<HomeHero getStartedHref="/auth/google" />);
const hero = parse(heroHtml);

describe("the home hero", () => {
  it("leads with the headline, two sentences in one h1 and the second on its own line, and no eyebrow", () => {
    const h1s = [...hero.querySelectorAll("h1")];
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("One connection to your tools.Your AI agent moves the work.");
    const second = h1s[0].querySelector("span")!;
    expect(second.textContent).toBe(HERO_HEADLINE[1]);
    expect(second.classList.contains("block")).toBe(true);
    // A bare whitespace-nowrap in the h1 clipped an earlier headline on every phone; it may only come back behind a
    // breakpoint. Checked on the rendered classes, so a class built by cn() is seen too.
    for (const el of [h1s[0], ...h1s[0].querySelectorAll("*")]) expect(el.classList.contains("whitespace-nowrap")).toBe(false);
    expect(heroHtml).not.toContain("ONE GATEWAY");
  });

  it("builds the subtitle from the public connector list, with the serial comma", () => {
    expect(HERO_SUBTITLE).toBe(
      "Connect Google Workspace, Atlassian, and Notion once, and your agent works across all of them, on every account you connect."
    );
    expect(hero.body.textContent).toContain(HERO_SUBTITLE);
  });

  it("has the two actions, and starts sign-in with a plain anchor", () => {
    const start = [...hero.querySelectorAll("a")].find((a) => a.textContent === "Get Started")!;
    expect(start.getAttribute("href")).toBe("/auth/google");
    const talk = [...hero.querySelectorAll("a")].find((a) => a.textContent === "Talk to Us")!;
    expect(talk.getAttribute("href")).toBe("/contact");
  });

  it("says the three trust facts, links the assessment and the repository, and no longer offers self-hosting", () => {
    const text = hero.body.textContent!;
    expect(text).toContain("Google-verified since June 2026 · CASA Tier 2 assessed · Open source");
    expect(text).not.toMatch(/self-host/i);
    const links = [...hero.querySelectorAll("a")];
    expect(links.find((a) => a.textContent === "CASA Tier 2 assessed")!.getAttribute("href")).toBe("/blog/casa-tier-2-verified");
    const repo = links.find((a) => a.textContent!.startsWith("Open source"))!;
    expect(repo.getAttribute("href")).toBe("https://github.com/datatorag/mcp-gateway");
    expect(repo.querySelector("svg")).not.toBeNull();
  });

  it("renders the wheel's tools as markup, so the box is not empty before the script runs", () => {
    const wheel = hero.querySelector('[aria-roledescription="tool wheel"]')!;
    const shown = [...wheel.querySelectorAll("li img")].map((img) => img.getAttribute("alt")).filter((alt) => alt !== "");
    expect([...shown].sort()).toEqual([...PUBLIC_SERVICES].sort());
    expect(wheel.querySelector('img[src="/datatorag-logo-256.png"]')).not.toBeNull();
    expect(wheel.querySelectorAll("canvas")).toHaveLength(2);
  });

  it("names the tool in the bottom slot, what an agent can do there, and its docs page", () => {
    const first = WHEEL_TOOLS[0];
    const link = [...hero.querySelectorAll("a")].find((a) => a.textContent === first.label)!;
    expect(link.getAttribute("href")).toBe(first.href);
    // The words fade in on a step only for a reader who has not asked for less motion: the class is defined under
    // prefers-reduced-motion: no-preference and nowhere else (comparison-hero.render.test.tsx holds that).
    expect(link.querySelector("span")!.classList.contains("hero-reveal")).toBe(true);
    expect(hero.body.textContent).toContain(first.canDo);
  });

  it("uses no dash as punctuation and says agent, never assistant", () => {
    expect(hero.body.textContent).not.toMatch(/[\u2013\u2014]/);
    expect(hero.body.textContent).not.toMatch(/assistant/i);
  });
});

describe("the wheel's tools", () => {
  it("are the public services and nothing admin-only, each with a logo and a docs page that exist", () => {
    expect(WHEEL_TOOLS.map((t) => t.label)).toEqual([...PUBLIC_SERVICES]);
    for (const t of WHEEL_TOOLS) {
      expect(["Brevo", "Slack", "PostHog"], t.label).not.toContain(t.label);
      expect(existsSync(join(PUBLIC_DIR, t.src)), t.src).toBe(true);
      expect(existsSync(join(DOCS_DIR, `${t.href.replace("/docs/", "")}.md`)), t.href).toBe(true);
      expect(t.canDo, t.label).toMatch(/^[A-Z][a-z]+, .*, and /);
    }
  });
});

describe("the Trusted by row", () => {
  const row = (tone: "dark" | "light") => parse(renderToStaticMarkup(<TrustedBy tone={tone} />));

  it("shows every entry of the list, in order, each named once", () => {
    const items = [...row("dark").querySelectorAll("li")];
    expect(items).toHaveLength(TRUSTED_BY.length);
    items.forEach((li, i) => {
      const entry = TRUSTED_BY[i];
      const img = li.querySelector("img")!;
      // Named by the image's alt, or by the words beside an icon; never both, never neither.
      expect(img.getAttribute("alt"), entry.name).toBe(entry.nameBeside ? "" : entry.name);
      expect(li.textContent, entry.name).toBe(entry.nameBeside ? entry.name : "");
    });
  });

  it("points only at files that exist", () => {
    for (const entry of TRUSTED_BY) {
      expect(existsSync(join(PUBLIC_DIR, "trusted-by", entry.file)), entry.file).toBe(true);
      if (entry.fileOnDark) expect(existsSync(join(PUBLIC_DIR, "trusted-by", entry.fileOnDark)), entry.fileOnDark).toBe(true);
    }
  });

  it("is white on a dark ground, except a mark that keeps its colors, and in its own colors on a light one", () => {
    const tinted = (img: Element) => img.className.includes("brightness-0");
    const dark = [...row("dark").querySelectorAll("img")];
    dark.forEach((img, i) => {
      const entry = TRUSTED_BY[i];
      if (entry.fileOnDark) expect(img.getAttribute("src")).toBe(`/trusted-by/${entry.fileOnDark}`);
      expect(tinted(img), entry.name).toBe(!entry.fileOnDark && !entry.keepColors);
    });
    const light = [...row("light").querySelectorAll("img")];
    light.forEach((img, i) => {
      expect(img.getAttribute("src")).toBe(`/trusted-by/${TRUSTED_BY[i].file}`);
      expect(tinted(img)).toBe(false);
    });
  });
});
