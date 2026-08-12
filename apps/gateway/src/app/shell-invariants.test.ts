/**
 * The two CSS properties that hold the app chrome still, pinned as source
 * assertions.
 *
 * WHY SOURCE TEXT AND NOT A RENDER. Both properties are layout behaviour, and
 * jsdom does not do layout: it has no scroll containers, no sticky resolution,
 * and no viewport. A mounted test would report success on markup that scrolls
 * away in a real browser, which is worse than no test, because it is a green
 * check next to the exact defect it is named after. So the behaviour is
 * verified in a browser, and what lives here is the narrow mechanical part —
 * that the class strings which produce the behaviour are still the ones we
 * chose. A fixed token, present or absent, no judgment.
 *
 * WHY IT IS WORTH A GUARD AT ALL. `globals.css` already reasons this out for
 * `html`, in a comment, correctly, and the same reasoning was never carried
 * one file across to `body`. The dashboard rail and the docs sidebar both
 * silently stopped sticking, and the docs one went unreported for as long as
 * it existed. `overflow-x-hidden` is also the more obvious-looking of the two,
 * so the realistic failure is not someone disagreeing, it is someone tidying
 * `clip` back to `hidden` and nothing anywhere objecting.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(join(import.meta.dirname, rel), "utf8");

/**
 * Source with comments removed, which is the only version worth asserting on.
 *
 * The first version of this file did not do that and failed immediately — on
 * a comment in the shell that EXPLAINS why `min-h-screen` was removed. A
 * banned token inside prose describing the ban is a false positive, and the
 * fix is not to stop writing the prose. Match the code.
 */
function code(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "") // block and JSX comments
    .replace(/^\s*\/\/.*$/gm, ""); // whole-line comments only, so URLs survive
}

describe("root layout does not break position: sticky", () => {
  const source = code(read("layout.tsx"));
  const bodyClasses = /<body className="([^"]*)"/.exec(source)?.[1];

  it("still has a body element with a class list to check", () => {
    // Without this, every assertion below passes by failing to find anything.
    expect(bodyClasses, "could not find <body className=…> in layout.tsx").toBeTruthy();
  });

  it("clips horizontally rather than hiding", () => {
    expect(bodyClasses).toContain("overflow-x-clip");
  });

  it("NEVER uses overflow-x-hidden on body", () => {
    // `hidden` makes body a scroll container. Sticky descendants then pin to
    // body's scrollport instead of the viewport, and since body itself never
    // scrolls, they travel with the page and appear not to stick at all.
    // `clip` stops the same overflow without creating the scroll container.
    expect(
      bodyClasses,
      "overflow-x-hidden on <body> makes it a scroll container, which silently " +
        "breaks every position:sticky descendant — the dashboard rail and the " +
        "docs sidebar. Use overflow-x-clip: same clipping, no scroll container."
    ).not.toContain("overflow-x-hidden");
  });
});

describe("the dashboard shell is one shell", () => {
  const source = code(read("dashboard/layout.tsx"));

  it("sizes the shell the same way on every route", () => {
    // The shell height must not branch. When it did, the offset correction ran
    // on one route and not the others, so the logo sat at a different height
    // depending on where you were, and the content routes scrolled the
    // document instead of the content area.
    expect(
      source,
      "the shell height is branching again — min-h-screen means the document " +
        "scrolls, which moves the rail and desynchronises the logo position"
    ).not.toContain("min-h-screen");
  });

  it("fits below top chrome unconditionally", () => {
    expect(source).toContain("useFitBelowTopChrome(shell, true)");
  });

  it("does not rely on sticky to hold the rail", () => {
    // Inert on every route now: nothing scrolls past the rail. Leaving it in
    // would read as the mechanism keeping the rail in place, and the next
    // person to debug this would start from the wrong element.
    expect(source).not.toContain("md:sticky");
  });
});
