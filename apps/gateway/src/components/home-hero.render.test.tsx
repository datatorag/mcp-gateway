// @vitest-environment jsdom

/**
 * The home page's hero as the server sends it: the heading and the ask, the
 * wheel's tools as markup (the canvas is drawn later, in the browser), and
 * the "Trusted by" row.
 */

import { existsSync, readFileSync } from "node:fs";
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
  it("leads with the headline, two sentences in one h1 and each on a line of its own, and no eyebrow", () => {
    const h1s = [...hero.querySelectorAll("h1")];
    expect(h1s).toHaveLength(1);
    expect(h1s[0].textContent).toBe("One connection to your tools.Your AI agent moves the work.");
    // Each sentence is its own block, so the second starts its own line at every width.
    const sentences = [...h1s[0].querySelectorAll(":scope > span")];
    expect(sentences.map((el) => el.textContent)).toEqual([...HERO_HEADLINE]);
    for (const el of sentences) {
      expect(el.classList.contains("block")).toBe(true);
      // One line each from 356px, where the smallest type still fits; narrower screens may wrap. A bare
      // whitespace-nowrap, at every width, clipped an earlier headline on every phone and must not come back.
      expect(el.classList.contains("min-[356px]:whitespace-nowrap")).toBe(true);
      expect(el.classList.contains("whitespace-nowrap")).toBe(false);
    }
    expect(h1s[0].classList.contains("whitespace-nowrap")).toBe(false);
    // The type follows the screen below the width where 30px no longer fits, and never goes under 22px; where it
    // does wrap, the lines are balanced, so no word is left alone.
    const size = [...h1s[0].classList].find((c) => c.startsWith("text-[length:"))!;
    expect(size).toBe("text-[length:max(22px,min(calc((100vw-48px)/14),clamp(30px,4vw,48px)))]");
    expect(h1s[0].classList.contains("[text-wrap:balance]")).toBe(true);
    expect(heroHtml).not.toContain("ONE GATEWAY");
  });

  it("builds the subtitle from the public connector list, with the serial comma, and sets the accounts claim in semibold", () => {
    const whole = HERO_SUBTITLE.join("");
    expect(whole).toBe(
      "Connect Google Workspace, Atlassian, and Notion once. Your agent works across all of them, and across multiple accounts in the same request."
    );
    expect(hero.body.textContent).toContain(whole);
    const strong = [...hero.querySelectorAll("p strong")];
    expect(strong.map((s) => s.textContent)).toEqual(["multiple accounts in the same request"]);
    expect(strong[0].classList.contains("font-semibold")).toBe(true);
    // Full ink against the softer line around it: white on the dark hero, the page's ink on a light one.
    expect(strong[0].classList.contains("text-white")).toBe(true);
    const light = parse(renderToStaticMarkup(<HomeHero getStartedHref="/auth/google" tone="light" />));
    expect(light.querySelector("p strong")!.classList.contains("text-[#1C1917]")).toBe(true);
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

describe("the hero's height (SCRUM-507)", () => {
  it("comes from its content, never from the window: nothing in the first section sizes itself by the viewport's height", () => {
    // A `min-h-screen` on the background wrapper once made the section as
    // tall as the window, which on a tall window left an empty band under the
    // Trusted by row. The class names are read from the source, because the
    // background is a WebGL component that does not render in this DOM.
    const read = (rel: string) => readFileSync(join(import.meta.dirname, rel), "utf8");
    const page = read("../app/page.tsx");
    const section = page.slice(page.indexOf("<ShaderBackground>"), page.indexOf("</ShaderBackground>"));
    expect(section).toContain("<HomeHero");
    const sources = { "shader-background.tsx": read("shader-background.tsx"), "page.tsx hero": section, "home-hero.tsx": read("home-hero.tsx"), "trusted-by.tsx": read("trusted-by.tsx") };
    for (const [name, text] of Object.entries(sources)) {
      const classes = [...text.matchAll(/className=(?:"([^"]*)"|\{[^}]*\})/g)].map((m) => m[0]).join(" ");
      expect(classes, name).not.toMatch(/\b(min-h-screen|h-screen|min-h-dvh|h-dvh|min-h-svh|h-svh)\b/);
      expect(classes, name).not.toMatch(/\[[^\]]*\d(vh|dvh|svh|lvh)\b/);
    }
  });
});

describe("the slot above the headline", () => {
  it("sets what it is given directly before the h1, out of the flow, and renders nothing when given nothing", () => {
    const withChip = parse(renderToStaticMarkup(<HomeHero getStartedHref="/auth/google" above={<a href="/pricing">offer</a>} />));
    const slot = withChip.querySelector("h1")!.previousElementSibling!;
    expect(slot.textContent).toBe("offer");
    // Absolute and anchored to the heading's top edge: the headline does not move when the chip comes or goes.
    expect(slot.classList.contains("absolute")).toBe(true);
    expect(slot.classList.contains("bottom-full")).toBe(true);
    expect(hero.querySelector("h1")!.previousElementSibling).toBeNull();
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
