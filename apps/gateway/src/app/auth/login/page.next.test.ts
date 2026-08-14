/**
 * The middle link of the `next` chain: this page's Google href.
 *
 * proxy.ts puts the requested route on the login URL and auth.ts stashes it —
 * but only if THIS page carries it across. A static href here is exactly how
 * the launch-email link died the first time: next reached the page and went
 * no further. So the href is asserted from the rendered element tree, not
 * from source text.
 */

import { describe, expect, it } from "vitest";
import LoginPage from "./page";

/** Depth-first search of a JSX element tree for the Google anchor. */
function findGoogleHref(node: unknown): string | null {
  if (node === null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findGoogleHref(child);
      if (found !== null) return found;
    }
    return null;
  }
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (
    el.type === "a" &&
    typeof el.props?.href === "string" &&
    el.props.href.startsWith("/auth/google")
  ) {
    return el.props.href;
  }
  return findGoogleHref(el.props?.children ?? null);
}

async function hrefFor(searchParams: { next?: string }) {
  const tree = await LoginPage({
    searchParams: Promise.resolve(searchParams),
  });
  const href = findGoogleHref(tree);
  expect(href, "no /auth/google anchor found in the login page").not.toBeNull();
  return href!;
}

describe("login page next passthrough", () => {
  it("carries a valid next onto the Google href, encoded", async () => {
    expect(await hrefFor({ next: "/dashboard/agent" })).toBe(
      "/auth/google?next=%2Fdashboard%2Fagent"
    );
  });

  it("drops an off-origin next instead of forwarding it", async () => {
    for (const evil of ["//evil.com", "https://evil.com", "/\\evil.com"]) {
      expect(await hrefFor({ next: evil })).toBe("/auth/google");
    }
  });

  it("renders the plain href when no next was asked for", async () => {
    expect(await hrefFor({})).toBe("/auth/google");
  });
});
