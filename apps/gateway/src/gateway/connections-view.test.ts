import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";

const listConnectedAccounts = vi.fn(async (): Promise<unknown[]> => []);
vi.mock("./connected-accounts", () => ({
  listConnectedAccounts: () => listConnectedAccounts(),
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

/* SCRUM-436: the dashboard names a Notion row by its workspace, so the view
 * must carry the name and the id that says the row has one. */
describe("loadConnectionsView: workspace fields", () => {
  it("carries label and externalAccountId through for every account", async () => {
    launchedServiceIds.mockResolvedValue(new Set(["notion"]));
    listConnectedAccounts.mockResolvedValueOnce([
      {
        id: "n1",
        connectorType: "notion",
        accountEmail: "person@example.com",
        label: "Acme Team",
        externalAccountId: "ws-acme",
        isDefault: true,
        scopes: null,
      },
    ]);
    const view = await loadConnectionsView(db, "user-1");
    expect(view.accounts[0]).toMatchObject({
      label: "Acme Team",
      externalAccountId: "ws-acme",
      accountEmail: "person@example.com",
    });
  });
});

/* SCRUM-436: the grant answer says whether the connector has scopes at all,
 * so no surface tells a Notion user their grant was never recorded. */
describe("loadConnectionsView: scope-less connectors", () => {
  it("marks a Notion row as having no scope grant, Google and Atlassian as having one", async () => {
    launchedServiceIds.mockResolvedValue(new Set(["notion"]));
    const row = (id: string, connectorType: string, scopes: string | null) => ({
      id,
      connectorType,
      accountEmail: "person@example.com",
      label: null,
      externalAccountId: null,
      isDefault: true,
      scopes,
    });
    listConnectedAccounts.mockResolvedValueOnce([
      row("n1", "notion", null),
      row("g1", "google-workspace", null),
      row("a1", "atlassian", "read:jira-work"),
    ]);
    const view = await loadConnectionsView(db, "user-1");
    const scoped = Object.fromEntries(view.accounts.map((a) => [a.id, a.scopeStatus.scoped]));
    expect(scoped).toEqual({ n1: false, g1: true, a1: true });
  });
});
