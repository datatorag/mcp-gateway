import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Tool counts drift every time a plugin ships or withholds a tool, and we have
 * shipped stale ones repeatedly — at one point the home page's own metadata
 * said one number while its body rendered another, on the same request.
 *
 * The fix is not to correct the number. It is to stop writing a claim that
 * needs syncing. Two shapes are safe:
 *
 *   - read it live from the registry, the way the home and pricing pages do
 *   - round it, so growth cannot falsify it ("70+ tools")
 *
 * An exact figure typed into copy is neither, and nothing else in this
 * repository would notice when it goes wrong.
 */

const ROOT = path.join(process.cwd());

/** Surfaces a stranger reads. Dashboard chart titles and test fixtures are
 * not claims about the product, so they are deliberately out of scope. */
const COPY_FILES = [
  "src/app/page.tsx",
  "src/app/pricing/page.tsx",
  "src/components/contact-page.tsx",
  "content/docs/google-workspace.md",
];

/** A bare count: "76 tools". Explicitly allows the two safe shapes, `70+
 * tools` and `~70 tools`, and any figure that is an expression rather than a
 * literal (a live value cannot be stale). */
const BARE_COUNT = /(?<![+~\d>{}])\b\d{2,3} tools\b/g;

describe("tool-count claims in site copy", () => {
  it.each(COPY_FILES)("%s states no exact tool count", (file) => {
    const source = readFileSync(path.join(ROOT, file), "utf-8");
    const matches = [...source.matchAll(BARE_COUNT)].map((m) => m[0]);
    expect(
      matches,
      `${file} hard-codes a tool count. Read it from the registry (see ` +
        `getToolCount) or round it ("70+ tools") — do not correct the number, ` +
        `it will be wrong again the next time a tool ships.`
    ).toEqual([]);
  });

  it("allows the two shapes that cannot go stale", () => {
    // Guards the guard: if this regex stopped matching, the test above would
    // pass by being blind rather than by the copy being correct.
    expect([..."We ship 76 tools today".matchAll(BARE_COUNT)]).toHaveLength(1);
    expect([..."We ship 70+ tools today".matchAll(BARE_COUNT)]).toHaveLength(0);
    expect([..."We ship ~70 tools today".matchAll(BARE_COUNT)]).toHaveLength(0);
  });
});
