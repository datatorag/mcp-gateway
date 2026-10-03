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

/** Does this source set the key in a metadata object, and without the spread? */
export function missingSpread(source: string, key: "openGraph" | "twitter", spread: string): boolean {
  const sets = new RegExp(`^\\s*${key}\\s*:`, "m").test(source);
  if (!sets) return false;
  // Either the object opens with the spread, or the key is the constant itself.
  const withSpread = new RegExp(`${key}\\s*:\\s*(\\{\\s*\\.\\.\\.${spread}\\b|${spread}\\b)`).test(source);
  return !withSpread;
}

describe("the site-wide social card (SCRUM-367)", () => {
  const files = sources(APP);

  it("finds the pages it is meant to check", () => {
    const setting = files.filter((f) => /^\s*openGraph\s*:/m.test(readFileSync(f, "utf8")));
    // The root layout and at least the home page, pricing and a blog post.
    expect(setting.length).toBeGreaterThan(5);
    expect(setting.map((f) => path.relative(APP, f))).toContain("layout.tsx");
  });

  it("every page that sets openGraph carries the card", () => {
    const missing = files.filter((f) => missingSpread(readFileSync(f, "utf8"), "openGraph", "SOCIAL_OPEN_GRAPH"));
    expect(missing.map((f) => path.relative(APP, f))).toEqual([]);
  });

  it("every page that sets twitter carries the card", () => {
    const missing = files.filter((f) => missingSpread(readFileSync(f, "utf8"), "twitter", "SOCIAL_TWITTER"));
    expect(missing.map((f) => path.relative(APP, f))).toEqual([]);
  });

  it("every page that sets openGraph sets twitter too, so the large card is never dropped", () => {
    // A page's own openGraph does not remove the root's twitter object, but a
    // page that describes itself for one crawler and not the other is the
    // drift this file exists to stop.
    const lopsided = files.filter((f) => {
      const s = readFileSync(f, "utf8");
      return /^\s*openGraph\s*:/m.test(s) !== /^\s*twitter\s*:/m.test(s);
    });
    expect(lopsided.map((f) => path.relative(APP, f))).toEqual([]);
  });

  it("the rule can go red: an object without the spread is caught, one with it is not", () => {
    expect(missingSpread(`  openGraph: {\n    title: "x",\n  },`, "openGraph", "SOCIAL_OPEN_GRAPH")).toBe(true);
    expect(missingSpread(`  openGraph: { title, url },`, "openGraph", "SOCIAL_OPEN_GRAPH")).toBe(true);
    expect(missingSpread(`  openGraph: {\n    ...SOCIAL_OPEN_GRAPH,\n    title: "x",\n  },`, "openGraph", "SOCIAL_OPEN_GRAPH")).toBe(false);
    expect(missingSpread(`  twitter: SOCIAL_TWITTER,`, "twitter", "SOCIAL_TWITTER")).toBe(false);
    expect(missingSpread(`  twitter: { card: "summary" },`, "twitter", "SOCIAL_TWITTER")).toBe(true);
    expect(missingSpread(`  title: "x",`, "openGraph", "SOCIAL_OPEN_GRAPH")).toBe(false);
  });

  it("no page turns the large card back into the small one", () => {
    const small = files.filter((f) => /card\s*:\s*["']summary["']/.test(readFileSync(f, "utf8")));
    expect(small.map((f) => path.relative(APP, f))).toEqual([]);
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
