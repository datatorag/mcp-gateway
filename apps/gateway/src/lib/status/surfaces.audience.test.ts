import { describe, expect, it, vi } from "vitest";

/* SCRUM-454: which plugins' tools the public status page leaves out is read
 * from the connectable-service registry's `audience` field, not from a list
 * kept beside it. A second admin-only service is left out with no edit here. */
vi.mock("@/app/dashboard/connections/service-registry", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/app/dashboard/connections/service-registry")>();
  const services = [
    ...real.CONNECTABLE_SERVICES,
    {
      id: "example-admin-service",
      name: "Example",
      connectUrl: "/auth/example/connect",
      launchPluginSlug: "example-mcp",
      audience: "admin" as const,
    },
  ];
  return {
    ...real,
    CONNECTABLE_SERVICES: services,
    ADMIN_AUDIENCE_PLUGIN_SLUGS: services
      .filter((s) => s.audience && s.launchPluginSlug)
      .map((s) => s.launchPluginSlug!),
  };
});

const { isPublicTool } = await import("./surfaces");

describe("tools of an admin-only service, from the registry (SCRUM-454)", () => {
  it("leaves out every plugin the registry gives an admin audience", () => {
    expect(isPublicTool("example-mcp__example_read")).toBe(false);
    expect(isPublicTool("slack-mcp__slack_channels_list")).toBe(false);
    expect(isPublicTool("brevo-mcp__campaign_send")).toBe(false);
    expect(isPublicTool("posthog-mcp__posthog_trends_query")).toBe(false);
  });

  it("keeps a plugin whose service has no audience", () => {
    expect(isPublicTool("notion-mcp__notion_search")).toBe(true);
    expect(isPublicTool("example-mcp-other__x")).toBe(true);
  });
});
