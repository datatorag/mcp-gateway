import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: vi.fn(async () => []),
}));
const launchedServiceIds = vi.fn();
vi.mock("./service-launch", () => ({
  launchedServiceIds: (...args: unknown[]) => launchedServiceIds(...args),
}));

const { loadConnectionsView } = await import("./connections-view");

/** The legacy read: select().from().where() resolving no rows, with the
 * subquery's own select().from().where() answering a builder. */
const db = {
  select: () => ({
    from: () => ({ where: () => Promise.resolve([]) }),
  }),
} as unknown as Database;

/* SCRUM-366: the one loader behind /api/connections and the Agent page's
 * server render carries which services may be offered, so the dashboard
 * cards and the agent's empty state hide a service that has not launched. */
describe("loadConnectionsView: launchedServices", () => {
  beforeEach(() => launchedServiceIds.mockReset());

  it("carries the launched set without Notion while its server row is absent", async () => {
    launchedServiceIds.mockResolvedValue(new Set(["google-workspace", "atlassian"]));
    const view = await loadConnectionsView(db, "user-1");
    expect(view.launchedServices.sort()).toEqual(["atlassian", "google-workspace"]);
    expect(launchedServiceIds).toHaveBeenCalledWith(db);
  });

  it("carries Notion once launched", async () => {
    launchedServiceIds.mockResolvedValue(new Set(["google-workspace", "atlassian", "notion"]));
    const view = await loadConnectionsView(db, "user-1");
    expect(view.launchedServices).toContain("notion");
  });
});
