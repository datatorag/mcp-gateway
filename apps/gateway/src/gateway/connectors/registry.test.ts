/**
 * The connector registry against the tree, and every map derived from it
 * against the literal it replaced. The first half is the check that makes a
 * forgotten connector an error: a plugin directory with no registry entry, or
 * an entry with no plugin, fails here. The second half pins the derivation:
 * each value is exactly what the hand-kept map said before it was derived.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { envSchema } from "@datatorag-mcp/config";
import { CONNECTOR_REGISTRY, connectorById, connectorSlugs, isConnectorId, vendorServed, type ConnectorRecord } from "./registry";
import { PLUGIN_SERVICE_MAP, SERVICE_PLUGIN_MAP } from "../service-token";
import { PROVIDERS } from "@/lib/analytics";
import { CONNECT_START, isDuplicateProvider } from "../connect-duplicate";
import { connectorGrantsScopes } from "../scope-grant";
import { PLUGIN_ROLES } from "../tests/execute";
import { CONNECTABLE_SERVICES } from "@/app/dashboard/connections/service-registry";

const PLUGINS_DIR = path.resolve(__dirname, "../../../../../plugins");

/** Every directory under plugins/ that carries a plugin manifest. */
function pluginDirs(): string[] {
  return readdirSync(PLUGINS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(path.join(PLUGINS_DIR, d.name, "datatorag.json")))
    .map((d) => d.name)
    .sort();
}

describe("the connector registry and plugins/", () => {
  it("has exactly one entry for every plugin directory, and a plugin directory for every entry", () => {
    const slugs = CONNECTOR_REGISTRY.map((c) => c.pluginSlug);
    expect(new Set(slugs).size).toBe(slugs.length);
    expect([...slugs].sort()).toEqual(pluginDirs());
  });

  it("gives a vendor's tools a slug of their own, shared with nothing", () => {
    const all = (CONNECTOR_REGISTRY as readonly ConnectorRecord[]).flatMap((c) => connectorSlugs(c));
    expect(new Set(all).size).toBe(all.length);
    for (const c of CONNECTOR_REGISTRY as readonly ConnectorRecord[]) {
      if (c.upstream) expect(PLUGIN_SERVICE_MAP[c.upstream.slug], c.id).toBe(c.id);
    }
    // The reverse map still names the plugin.
    expect(SERVICE_PLUGIN_MAP.slack).toBe("slack-mcp");
  });

  it("declares an upstream only as an https URL, and finds its connector by the vendor's slug", () => {
    for (const c of CONNECTOR_REGISTRY as readonly ConnectorRecord[]) {
      expect(vendorServed(c.pluginSlug), c.id).toBeUndefined();
      if (!c.upstream) continue;
      expect(new URL(c.upstream.url).protocol, c.id).toBe("https:");
      expect(vendorServed(c.upstream.slug)?.id, c.id).toBe(c.id);
    }
    expect(vendorServed("slack-hosted")?.upstream.url).toBe("https://mcp.slack.com/mcp");
  });

  it("names each connector once", () => {
    for (const field of ["id", "providerKey", "connectUrl", "displayName"] as const) {
      const values = CONNECTOR_REGISTRY.map((c) => c[field]);
      expect(new Set(values).size, field).toBe(values.length);
    }
  });

  it("gives every connector with client credentials both keys in the config schema", () => {
    const keys = Object.keys(envSchema.shape);
    for (const c of CONNECTOR_REGISTRY) {
      if (c.envPrefix === null) continue;
      expect(keys, c.id).toContain(`${c.envPrefix}_CLIENT_ID`);
      expect(keys, c.id).toContain(`${c.envPrefix}_CLIENT_SECRET`);
    }
  });

  it("starts each connect on its own route", () => {
    for (const c of CONNECTOR_REGISTRY) expect(c.connectStart.startsWith(c.connectUrl), c.id).toBe(true);
  });

  it("knows a connector by id and nothing else, not even an inherited name", () => {
    expect(connectorById("notion")?.pluginSlug).toBe("notion-mcp");
    for (const v of ["toString", "__proto__", "constructor", "", "google", 1, null]) {
      expect(isConnectorId(v)).toBe(false);
      expect(isDuplicateProvider(v)).toBe(false);
    }
  });
});

describe("what the registry derives, against the literals it replaced", () => {
  it("PLUGIN_SERVICE_MAP and its reverse", () => {
    expect(PLUGIN_SERVICE_MAP).toEqual({
      "gws-mcp": "google-workspace",
      "atlassian-mcp": "atlassian",
      "notion-mcp": "notion",
      "brevo-mcp": "brevo",
      "slack-mcp": "slack",
      // Slack's vendor-served tools, beside the plugin (official-mcp-proxy).
      "slack-hosted": "slack",
      "posthog-mcp": "posthog",
    });
    // One plugin per service; a vendor's slug is never the reverse's answer.
    expect(SERVICE_PLUGIN_MAP).toEqual({
      "google-workspace": "gws-mcp",
      atlassian: "atlassian-mcp",
      notion: "notion-mcp",
      brevo: "brevo-mcp",
      slack: "slack-mcp",
      posthog: "posthog-mcp",
    });
  });

  it("PROVIDERS", () => {
    expect(PROVIDERS).toEqual({
      GOOGLE_WORKSPACE: "google-workspace",
      ATLASSIAN: "atlassian",
      NOTION: "notion",
      BREVO: "brevo",
      SLACK: "slack",
      POSTHOG: "posthog",
    });
  });

  it("CONNECT_START", () => {
    expect(CONNECT_START).toEqual({
      "google-workspace": "/auth/google/connect?proceed=1",
      atlassian: "/auth/atlassian/connect",
      notion: "/auth/notion/connect",
      brevo: "/auth/brevo/connect",
      slack: "/auth/slack/connect",
      posthog: "/auth/posthog/connect",
    });
  });

  it("the connectors without scopes", () => {
    expect(CONNECTOR_REGISTRY.map((c) => c.id).filter((id) => !connectorGrantsScopes(id))).toEqual(["notion", "brevo", "posthog"]);
    expect(connectorGrantsScopes("some-future-service")).toBe(true);
  });

  it("PLUGIN_ROLES", () => {
    expect(PLUGIN_ROLES).toEqual({
      "gws-mcp": ["sender", "reader"],
      "atlassian-mcp": ["atlassian"],
      "notion-mcp": ["notion", "notionSecond"],
      "brevo-mcp": ["brevo"],
      "slack-mcp": ["slack"],
      "posthog-mcp": ["posthog"],
    });
  });

  it("CONNECTABLE_SERVICES, in the dashboard's order and shape", () => {
    expect(CONNECTABLE_SERVICES).toEqual([
      { id: "google-workspace", name: "Google Workspace", connectUrl: "/auth/google/connect" },
      { id: "atlassian", name: "Atlassian", connectUrl: "/auth/atlassian/connect" },
      { id: "notion", name: "Notion", connectUrl: "/auth/notion/connect", launchPluginSlug: "notion-mcp" },
      { id: "brevo", name: "Brevo", connectUrl: "/auth/brevo/connect", launchPluginSlug: "brevo-mcp", audience: "admin" },
      { id: "slack", name: "Slack", connectUrl: "/auth/slack/connect", launchPluginSlug: "slack-mcp", audience: "admin" },
      { id: "posthog", name: "PostHog", connectUrl: "/auth/posthog/connect", launchPluginSlug: "posthog-mcp", audience: "admin" },
    ]);
  });
});
