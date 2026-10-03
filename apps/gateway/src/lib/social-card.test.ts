import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { SOCIAL_CARD, SOCIAL_OPEN_GRAPH, SOCIAL_TWITTER } from "./social-card";

/**
 * The link-preview card reaches every page (SCRUM-367).
 *
 * Next replaces `openGraph` and `twitter` whole when a page sets its own, so
 * the card is only on a page that either sets neither or spreads the shared
 * constants in. These tests read the app tree, because the failure is a page
 * that forgot, and no test of the constants themselves can see that.
 */

const APP = path.resolve(process.cwd(), "src/app");

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sources(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) ? [full] : [];
  });
}

/** The text of the object literal opening at `open` (a `{`), braces matched. */
function objectAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  return source.slice(open);
}

/**
 * Every place a source sets `key`, judged ONE OBJECT AT A TIME, wherever it
 * sits on its line. Returns what is wrong with each, empty when all are fine.
 *
 * An earlier version asked one question per file, anchored to the start of a
 * line. A second object in the same file passed on the strength of the first,
 * `return { openGraph: {` on one line was never seen, and an object that
 * spread the constants and then set `images: []` passed while serving nothing.
 */
export function problems(source: string, key: "openGraph" | "twitter", spread: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(new RegExp(`(?<![.\\w])${key}\\s*:\\s*`, "g"))) {
    const at = m.index! + m[0].length;
    const rest = source.slice(at);
    if (new RegExp(`^${spread}\\b`).test(rest)) continue; // the constant itself
    if (!rest.startsWith("{")) {
      found.push(`${key} is set to something other than an object or ${spread}`);
      continue;
    }
    const body = objectAt(source, at);
    if (!new RegExp(`^\\{\\s*\\.\\.\\.${spread}\\b`).test(body)) {
      found.push(`${key} does not start with ...${spread}`);
    }
    // An own `images` may only be the conditional kind the blog uses; a
    // literal empty list, null or undefined throws the card away.
    if (/\bimages\s*:\s*(\[\s*\]|null\b|undefined\b)/.test(body)) {
      found.push(`${key} sets images to nothing`);
    }
    if (key === "twitter" && /\bcard\s*:/.test(body)) {
      found.push("twitter sets its own card type");
    }
  }
  return found;
}

function count(source: string, key: string): number {
  return [...source.matchAll(new RegExp(`(?<![.\\w])${key}\\s*:`, "g"))].length;
}

describe("the site-wide social card (SCRUM-367)", () => {
  const files = sources(APP);

  const read = (f: string) => readFileSync(f, "utf8");
  const rel = (f: string) => path.relative(APP, f);

  it("finds the pages it is meant to check", () => {
    const setting = files.filter((f) => count(read(f), "openGraph") > 0);
    // The root layout and at least the home page, pricing and a blog post.
    expect(setting.length).toBeGreaterThan(5);
    expect(setting.map(rel)).toContain("layout.tsx");
  });

  it("every openGraph object carries the card", () => {
    const bad = files.flatMap((f) => problems(read(f), "openGraph", "SOCIAL_OPEN_GRAPH").map((p) => `${rel(f)}: ${p}`));
    expect(bad).toEqual([]);
  });

  it("every twitter object carries the card and keeps the large card type", () => {
    const bad = files.flatMap((f) => problems(read(f), "twitter", "SOCIAL_TWITTER").map((p) => `${rel(f)}: ${p}`));
    expect(bad).toEqual([]);
  });

  it("a file sets twitter as many times as it sets openGraph", () => {
    // A page that describes itself for one crawler and not the other is the
    // drift this file exists to stop, object for object.
    const lopsided = files.filter((f) => count(read(f), "openGraph") !== count(read(f), "twitter"));
    expect(lopsided.map(rel)).toEqual([]);
  });

  it("the rule can go red on each shape that used to pass", () => {
    const OG = "SOCIAL_OPEN_GRAPH";
    const good = `  openGraph: {\n    ...SOCIAL_OPEN_GRAPH,\n    title: "x",\n  },`;
    expect(problems(good, "openGraph", OG)).toEqual([]);
    expect(problems(`  twitter: SOCIAL_TWITTER,`, "twitter", "SOCIAL_TWITTER")).toEqual([]);
    expect(problems(`  title: "x",`, "openGraph", OG)).toEqual([]);
    // No spread at all.
    expect(problems(`  openGraph: {\n    title: "x",\n  },`, "openGraph", OG)).toHaveLength(1);
    // Not at the start of a line.
    expect(problems(`  return { openGraph: { title, url } };`, "openGraph", OG)).toHaveLength(1);
    // A second object in the same file, after a good one.
    expect(problems(`${good}\n  const other = { openGraph: { title: "y" } };`, "openGraph", OG)).toHaveLength(1);
    // The spread, then the card thrown away.
    expect(problems(`  openGraph: { ...SOCIAL_OPEN_GRAPH, images: [] },`, "openGraph", OG)).toEqual(["openGraph sets images to nothing"]);
    expect(problems(`  openGraph: { ...SOCIAL_OPEN_GRAPH, images: undefined },`, "openGraph", OG)).toHaveLength(1);
    // The spread is there but not first, so a later key could not be the issue; still refused.
    expect(problems(`  openGraph: { title: "x", ...SOCIAL_OPEN_GRAPH },`, "openGraph", OG)).toHaveLength(1);
    // The small card back again.
    expect(problems(`  twitter: { ...SOCIAL_TWITTER, card: "summary" },`, "twitter", "SOCIAL_TWITTER")).toEqual(["twitter sets its own card type"]);
    // A property read is not a definition.
    expect(problems(`  const og = metadata.openGraph;`, "openGraph", OG)).toEqual([]);
  });

  it("the card is an absolute production URL with its size, type and alt", () => {
    expect(SOCIAL_CARD.url).toBe("https://datatorag.com/social-card.png");
    expect(SOCIAL_CARD).toMatchObject({ width: 1200, height: 630, type: "image/png" });
    expect(SOCIAL_CARD.alt.length).toBeGreaterThan(0);
    expect(SOCIAL_OPEN_GRAPH.images).toEqual([SOCIAL_CARD]);
    expect(SOCIAL_TWITTER).toMatchObject({ card: "summary_large_image", images: [SOCIAL_CARD] });
  });

  it("the file it names exists, is a 1200x630 PNG, and is under 1 MB", () => {
    const file = path.resolve(process.cwd(), "public", path.basename(new URL(SOCIAL_CARD.url).pathname));
    const png = readFileSync(file);
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    // IHDR: width and height are the two big-endian uint32s at byte 16.
    expect(png.readUInt32BE(16)).toBe(SOCIAL_CARD.width);
    expect(png.readUInt32BE(20)).toBe(SOCIAL_CARD.height);
    expect(png.length).toBeLessThan(1024 * 1024);
  });
});
