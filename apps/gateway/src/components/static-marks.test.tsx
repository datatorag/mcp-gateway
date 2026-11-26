// @vitest-environment jsdom

/**
 * The yes/no marks on the home page cost nothing per instance beyond their
 * own markup.
 *
 * lucide-react's base `Icon` is a client component ("use client" since v1).
 * Rendered from a server component, every icon is therefore a client
 * reference: the HTML carries the drawn SVG and the page's framework payload
 * carries the icon again as props (its class, and a long path to its shape).
 * The full comparison table alone drew 72 ticks that way, and the home page
 * as a whole 104 icons, about 28 KB of payload on top of 30 KB of SVG markup.
 *
 * `CheckMark` and `MinusMark` are plain server markup, an empty span drawn by
 * a CSS mask (`icon-check`, `icon-minus` in globals.css). These tests fail if
 * a lucide icon comes back into the server components that repeat a mark.
 */

import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CheckMark, MinusMark } from "./static-marks";
import { ConnectorComparison, GROUPS, heroGroups } from "./connector-comparison";
import { ComparisonHero } from "./comparison-hero";
import { BUILT_IN_CHECKED_ON } from "@/lib/connector-verification";

vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
);
const { DemoBento } = await import("./demo/demo-bento");

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("CheckMark and MinusMark", () => {
  it("are one empty, hidden span each, carrying the caller's classes", () => {
    expect(renderToStaticMarkup(<CheckMark className="size-4 text-primary" />)).toBe(
      '<span aria-hidden="true" class="icon-check size-4 text-primary"></span>'
    );
    expect(renderToStaticMarkup(<MinusMark className="size-4" />)).toBe(
      '<span aria-hidden="true" class="icon-minus size-4"></span>'
    );
  });

  it("are drawn by a CSS mask that globals.css defines", () => {
    const css = readFileSync(join(__dirname, "../app/globals.css"), "utf8");
    for (const name of ["icon-check", "icon-minus"]) {
      const block = css.match(new RegExp(`@utility ${name} \\{([^}]*)\\}`))?.[1] ?? "";
      expect(block, name).toContain("mask-image");
      expect(block, name).toContain("background-color: currentColor");
    }
  });
});

describe("the home page's repeated marks are not lucide icons", () => {
  it("the full comparison table: one mark per cell, no lucide icon, and a bounded size", () => {
    const html = renderToStaticMarkup(<ConnectorComparison />);
    const rows = GROUPS.flatMap((g) => g.rows);
    const ticks = rows.filter((r) => r.builtIn).length + rows.filter((r) => r.ours).length;
    expect(html).not.toContain("lucide");
    expect(count(html, 'class="icon-check')).toBe(ticks);
    expect(count(html, 'class="icon-minus')).toBe(rows.filter((r) => !r.ours).length);
    // 28.9 KB of markup with the marks as spans; 48.2 KB with a lucide SVG in
    // every cell. The payload repeats every element, so this bounds both.
    expect(html.length).toBeLessThan(36_000);
  });

  it("the comparison hero", () => {
    const html = renderToStaticMarkup(<ComparisonHero groups={heroGroups()} checkedOn={BUILT_IN_CHECKED_ON} />);
    expect(html).not.toContain("lucide");
    expect(count(html, 'class="icon-check')).toBeGreaterThan(0);
  });

  it("the demo rows", () => {
    const html = renderToStaticMarkup(<DemoBento heading="h" standfirst={["s"]} />);
    expect(html).not.toContain("lucide-circle");
    expect(count(html, 'class="icon-check')).toBeGreaterThan(0);
    expect(count(html, 'class="icon-minus')).toBeGreaterThan(0);
  });
});
