/**
 * SCRUM-468: a service can be offered to admins only (`audience: "admin"`),
 * on top of the launch gate. Brevo is, while its OAuth app is private to our
 * own Brevo organisation. Every surface that offers a connect reads
 * `offeredServiceIdsFor`; the connect route reads `serviceOfferedTo`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const isAdmin = vi.fn();
/** A role read that fails, as a plain function: vitest reports a rejection
 * from a vi.fn even when the code under test catches it. */
let roleReadFails = false;
vi.mock("./admin", () => ({
  isAdmin: async (...a: unknown[]) => {
    if (roleReadFails) throw new Error("db down");
    return isAdmin(...a);
  },
}));

import { offeredServiceIdsFor, serviceOfferedTo } from "./service-launch";

/** Both gated plugins launched. */
const db = {
  select: () => ({ from: () => ({ where: async () => [{ slug: "notion-mcp" }, { slug: "brevo-mcp" }] }) }),
} as unknown as Database;

beforeEach(() => {
  isAdmin.mockReset();
  roleReadFails = false;
});

describe("offeredServiceIdsFor", () => {
  it("offers Brevo to an admin, with every launched service", async () => {
    isAdmin.mockResolvedValue(true);
    expect([...(await offeredServiceIdsFor(db, "admin-1"))].sort()).toEqual(["atlassian", "brevo", "google-workspace", "notion"]);
  });

  it("never offers Brevo to anyone else, and leaves the others as they were", async () => {
    isAdmin.mockResolvedValue(false);
    expect([...(await offeredServiceIdsFor(db, "user-1"))].sort()).toEqual(["atlassian", "google-workspace", "notion"]);
    expect(await serviceOfferedTo(db, "brevo", "user-1")).toBe(false);
    expect(await serviceOfferedTo(db, "notion", "user-1")).toBe(true);
  });

  it("fails closed when the role cannot be read", async () => {
    roleReadFails = true;
    expect(await serviceOfferedTo(db, "brevo", "user-1")).toBe(false);
  });

  it("does not offer Brevo to an admin before its plugin has launched", async () => {
    isAdmin.mockResolvedValue(true);
    const unlaunched = { select: () => ({ from: () => ({ where: async () => [{ slug: "notion-mcp" }] }) }) } as unknown as Database;
    expect(await serviceOfferedTo(unlaunched, "brevo", "admin-1")).toBe(false);
  });
});
