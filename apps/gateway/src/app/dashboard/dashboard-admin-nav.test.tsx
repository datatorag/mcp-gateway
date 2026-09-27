// @vitest-environment jsdom

/**
 * The Admin rail item (SCRUM-351): rendered for an admin, absent for a
 * member, active on /dashboard/admin and everything under it. The item is a
 * convenience; the admin layout's server guard (SCRUM-302) stays the access
 * control, and its own tests are untouched by this.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

const state = vi.hoisted(() => ({
  pathname: "/dashboard",
  user: null as null | { id: string; name: string; email: string; avatarUrl: null; role?: string },
}));

vi.mock("next/navigation", () => ({ usePathname: () => state.pathname }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: Record<string, unknown>) => (
    <a href={href as string} {...props}>
      {children as React.ReactNode}
    </a>
  ),
}));
vi.mock("next/image", () => ({
  default: (props: Record<string, unknown>) => (
    // eslint-disable-next-line @next/next/no-img-element, jsx-a11y/alt-text
    <img {...(props as React.ImgHTMLAttributes<HTMLImageElement>)} />
  ),
}));
vi.mock("@/lib/use-current-user", () => ({ useCurrentUser: () => state.user }));
vi.mock("@/lib/use-fit-below-top-chrome", () => ({ useFitBelowTopChrome: () => {} }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
if (!("scrollTo" in Element.prototype)) {
  (Element.prototype as unknown as { scrollTo: () => void }).scrollTo = () => {};
}

const { default: DashboardLayout } = await import("./layout");

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function render(user: typeof state.user, pathname: string) {
  state.user = user;
  state.pathname = pathname;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root!.render(
      <DashboardLayout>
        <div>content</div>
      </DashboardLayout>
    );
  });
  return container;
}

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  root = undefined;
  container = undefined;
});

const base = { id: "u1", name: "Nav Test", email: "nav@example.com", avatarUrl: null };
const railLinks = (c: HTMLElement) =>
  Array.from(c.querySelectorAll<HTMLAnchorElement>("#dashboard-rail-nav a"));
const adminLink = (c: HTMLElement) => railLinks(c).find((a) => a.getAttribute("href") === "/dashboard/admin");

describe("the Admin rail item", () => {
  it("is present for an admin, labelled and linking to /dashboard/admin", () => {
    const c = render({ ...base, role: "admin" }, "/dashboard");
    const link = adminLink(c);
    expect(link).toBeDefined();
    expect(link!.getAttribute("aria-label")).toBe("Admin");
    // Same styling as its siblings: the class list of an inactive item.
    const usage = railLinks(c).find((a) => a.getAttribute("href") === "/dashboard/usage")!;
    expect(link!.className).toBe(usage.className);
  });

  it("is absent for a member, and for a user whose role has not loaded", () => {
    for (const user of [{ ...base, role: "user" }, { ...base }, null]) {
      const c = render(user, "/dashboard");
      expect(adminLink(c)).toBeUndefined();
      expect(c.textContent).not.toContain("Admin");
      act(() => root!.unmount());
      container!.remove();
      root = undefined;
      container = undefined;
    }
  });

  it("is active on /dashboard/admin and on every page under it, and only there", () => {
    for (const [path, active] of [
      ["/dashboard/admin", true],
      ["/dashboard/admin/tests/abc", true],
      ["/dashboard/administrator", false],
      ["/dashboard/usage", false],
    ] as const) {
      const c = render({ ...base, role: "admin" }, path);
      expect(adminLink(c)!.getAttribute("aria-current")).toBe(active ? "page" : null);
      act(() => root!.unmount());
      container!.remove();
      root = undefined;
      container = undefined;
    }
  });

  it("appears in the mobile menu for an admin too", () => {
    const c = render({ ...base, role: "admin" }, "/dashboard");
    act(() => {
      c.querySelector<HTMLButtonElement>('button[aria-label="Toggle menu"]')!.click();
    });
    const mobile = Array.from(c.querySelectorAll<HTMLAnchorElement>("nav.md\\:hidden a")).map((a) => a.getAttribute("href"));
    expect(mobile).toContain("/dashboard/admin");
  });
});
