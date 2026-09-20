/**
 * /api/me carries the caller's own role (SCRUM-302).
 *
 * It is what the dashboard rail reads to decide whether to render the admin
 * entry. Presentation only: every admin surface re-reads the column on the
 * server, so a client that patches this answer gains nothing but a link that
 * 404s.
 */

import { describe, expect, it, vi } from "vitest";

const getSessionUserId = vi.fn().mockResolvedValue("user-1");
vi.mock("@/lib/session", () => ({ getSessionUserId: () => getSessionUserId() }));

const row = { id: "user-1", email: "a@example.com", name: null, avatarUrl: null, plan: "free", role: "admin" };
const selected: Record<string, unknown>[] = [];
vi.mock("@/lib/db", () => ({
  db: {
    select: (cols: Record<string, unknown>) => {
      selected.push(cols);
      const p = Promise.resolve([row]) as Promise<unknown> & Record<string, unknown>;
      for (const m of ["from", "where", "limit"]) p[m] = () => p;
      return p;
    },
  },
}));

import { GET } from "./route";

describe("GET /api/me", () => {
  it("selects the role column and returns it", async () => {
    const res = await GET(new Request("http://localhost/api/me") as never, undefined as never);
    const body = await res.json();
    expect(body.user.role).toBe("admin");
    // The projection is explicit, so asserting the column is asked for keeps
    // the answer from silently becoming undefined if the select is edited.
    expect(Object.keys(selected[0])).toContain("role");
  });
});
