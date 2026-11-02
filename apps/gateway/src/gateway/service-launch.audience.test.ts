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
import { CONNECTABLE_SERVICES, PUBLIC_SERVICE_IDS } from "@/app/dashboard/connections/service-registry";

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

describe("the connect tool's service enum (SCRUM-454)", () => {
  it("never names an audience-gated service, and names every other", async () => {
    const { BUILT_IN_TOOLS } = await import("./mcp-server");
    const connect = BUILT_IN_TOOLS.find((t) => t.definition.name === "connect")!;
    const props = connect.definition.inputSchema.properties as Record<string, { enum?: string[] }>;
    const gated = CONNECTABLE_SERVICES.filter((s) => s.audience).map((s) => s.id);
    expect(gated).toContain("brevo");
    for (const id of gated) expect(props.service.enum).not.toContain(id);
    expect(props.service.enum).toEqual([...PUBLIC_SERVICE_IDS]);
    expect(props.service.enum).toEqual(CONNECTABLE_SERVICES.filter((s) => !s.audience).map((s) => s.id));
  });
});

/** SCRUM-454: Slack is the second admin-audience service, on the same helper. */
describe("slack", () => {
  const withSlack = {
    select: () => ({
      from: () => ({ where: async () => [{ slug: "notion-mcp" }, { slug: "brevo-mcp" }, { slug: "slack-mcp" }] }),
    }),
  } as unknown as Database;

  it("is declared admin-only and is never in the public ids", () => {
    const slack = CONNECTABLE_SERVICES.find((s) => s.id === "slack");
    expect(slack).toMatchObject({
      name: "Slack",
      connectUrl: "/auth/slack/connect",
      launchPluginSlug: "slack-mcp",
      audience: "admin",
    });
    expect(PUBLIC_SERVICE_IDS).not.toContain("slack");
  });

  it("a non-admin is not offered slack even once slack-mcp is active", async () => {
    isAdmin.mockResolvedValue(false);
    expect((await offeredServiceIdsFor(withSlack, "user-1")).has("slack")).toBe(false);
    expect(await serviceOfferedTo(withSlack, "slack", "user-1")).toBe(false);
  });

  it("an admin is offered slack once slack-mcp is active, and not before", async () => {
    isAdmin.mockResolvedValue(true);
    expect((await offeredServiceIdsFor(withSlack, "admin-1")).has("slack")).toBe(true);
    expect(await serviceOfferedTo(db, "slack", "admin-1")).toBe(false);
  });

  it("fails closed for slack when the role cannot be read", async () => {
    roleReadFails = true;
    expect(await serviceOfferedTo(withSlack, "slack", "admin-1")).toBe(false);
  });
});
