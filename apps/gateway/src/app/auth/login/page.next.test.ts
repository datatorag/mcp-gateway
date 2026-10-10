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

/* SCRUM-408: this page is where a sign-in that did not finish comes back. */
describe("the login page as the place sign-in returns to", () => {
  function textOf(node: unknown): string {
    if (node === null || node === undefined || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(textOf).join("");
    const el = node as { type?: unknown; props?: Record<string, unknown> };
    if (typeof el.type === "function") {
      return textOf((el.type as (p: unknown) => unknown)(el.props));
    }
    return textOf(el.props?.children);
  }
  const render = async (searchParams: { next?: string; error?: string }) =>
    textOf(await LoginPage({ searchParams: Promise.resolve(searchParams) }));

  it("says a sign-in did not finish, in its own words, whatever the code", async () => {
    for (const error of ["cancelled", "invalid_state", "exchange_failed", "<b>x</b>"]) {
      const text = await render({ error });
      expect(text, error).toContain("That sign-in did not finish.");
      // The code is ours, for logs. It is never put on the page.
      expect(text, error).not.toContain(error);
    }
  });

  it("says nothing of the kind on an ordinary visit", async () => {
    expect(await render({})).not.toContain("did not finish");
    expect(await render({ error: "" })).not.toContain("did not finish");
  });

  it("still says what signing in agrees to, both documents", async () => {
    const text = await render({});
    expect(text).toContain("Terms of Service");
    expect(text).toContain("Privacy Policy");
  });

  it("keeps the return path through a failed attempt", async () => {
    expect(await hrefFor({ next: "/pricing", error: "cancelled" } as { next?: string })).toBe(
      "/auth/google?next=%2Fpricing"
    );
  });
});

