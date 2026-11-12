import { describe, expect, it, vi } from "vitest";

/* SCRUM-487: the MCP config page is retired into Home, and its address keeps
 * working for old bookmarks and links by redirecting there, with no fragment
 * of its own so an old `#<client>` hash survives the redirect. */
const redirect = vi.fn((to: string) => {
  throw new Error(`NEXT_REDIRECT ${to}`);
});
vi.mock("next/navigation", () => ({ redirect: (to: string) => redirect(to) }));

const { default: McpConfigPage } = await import("./page");

describe("/dashboard/mcp-config", () => {
  it("redirects to Home, with no fragment of its own", () => {
    expect(() => McpConfigPage()).toThrow("NEXT_REDIRECT /dashboard");
    expect(redirect).toHaveBeenCalledWith("/dashboard");
  });
});
