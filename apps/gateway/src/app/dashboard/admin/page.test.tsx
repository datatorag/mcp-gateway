import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

/* SCRUM-487: the admin index lists the admin tools, the test runner first,
 * and still awaits the guard before it renders anything. */
const guard = vi.hoisted(() => ({ calls: 0, refuse: false }));
vi.mock("@/gateway/admin-page", () => ({
  requireAdminPage: async () => {
    guard.calls++;
    if (guard.refuse) throw new Error("NEXT_NOT_FOUND");
  },
}));

const { default: AdminIndexPage, ADMIN_TOOLS } = await import("./page");

describe("the admin index", () => {
  it("links the test runner, and no longer says nothing is wired up", async () => {
    guard.refuse = false;
    const html = renderToStaticMarkup(await AdminIndexPage());
    expect(html).toContain('href="/dashboard/admin/tests"');
    expect(html).toContain("Test runner");
    expect(html).not.toContain("Nothing is wired up yet");
    expect(ADMIN_TOOLS.every((t) => t.href.startsWith("/dashboard/admin/"))).toBe(true);
  });

  it("renders nothing for someone the guard refuses", async () => {
    guard.refuse = true;
    guard.calls = 0;
    await expect(AdminIndexPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(guard.calls).toBe(1);
  });
});
