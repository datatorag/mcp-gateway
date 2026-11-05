/**
 * The connectors, one record each: every fact about a connector that other
 * modules used to restate in their own map.
 *
 * A connector is a third-party service a user connects (an OAuth grant) and
 * the plugin that serves its tools. Adding one used to mean remembering the
 * plugin-to-service map, its reverse, the analytics provider ids, the
 * dashboard's list, the duplicate page's provider type and nouns, the connect
 * link's button names, the scope rule and the runner's roles; forgetting one
 * was a silent gap, not an error. Each of those is now derived from this list
 * (or typed by its ids, so a missing entry fails to compile), and
 * `registry.test.ts` checks this list against `plugins/` on disk.
 *
 * Pure data: no imports with side effects, nothing from Node, so the browser
 * bundle can import it through the dashboard's service list. What a
 * connector DOES (refresh, revoke, context headers) stays in the modules that
 * own it, in maps typed by `ConnectorId`.
 */
import type { AccountRole } from "../tests/types";

export interface ConnectorRecord {
  /** The service name: the `service` column of a connection, the provider
   * id in analytics, and the key of every per-connector map. */
  readonly id: string;
  /** The plugin directory under `plugins/` that serves its tools. */
  readonly pluginSlug: string;
  /** The service's name on every surface. */
  readonly displayName: string;
  /** The provider's own name, on a button that continues to its site. */
  readonly providerName: string;
  /** What one connection of it is called: an account, a workspace, a project. */
  readonly accountNoun: string;
  /** Its key in `PROVIDERS` (analytics). */
  readonly providerKey: string;
  /** The prefix of its OAuth client credentials in the environment
   * (`<prefix>_CLIENT_ID`, `<prefix>_CLIENT_SECRET`), or null when the
   * connector has no client secret (PostHog's client is a metadata URL). */
  readonly envPrefix: string | null;
  /** The Express route that starts its connect. */
  readonly connectUrl: string;
  /** Where a connect restarts past any interstitial: the duplicate page's
   * restart and a connect link hand over here. */
  readonly connectStart: string;
  /** `"scopes"`: a grant is a set of OAuth scopes, checked per tool.
   * `"none"`: there is nothing to check (no scopes, or scopes the consent
   * screen does not let the user change). */
  readonly scopeModel: "scopes" | "none";
  /** `"always"`: offered with no registry check. `"registry"`: hidden until
   * the plugin's `mcp_servers` row is active (see `service-launch.ts`). */
  readonly launch: "always" | "registry";
  /** `"admin"`: offered to admins only, on every surface. */
  readonly audience?: "admin";
  /** Whether the provider can be told to drop the grant on disconnect. */
  readonly revokes: boolean;
  /** Whether its plugin is handed context headers beside the token. */
  readonly contextHeaders: boolean;
  /** The runner account roles its tools may be called as; the first is the
   * one a contract probe runs as. */
  readonly runnerRoles: readonly AccountRole[];
}

export const CONNECTOR_REGISTRY = [
  {
    id: "google-workspace",
    pluginSlug: "gws-mcp",
    displayName: "Google Workspace",
    providerName: "Google",
    accountNoun: "Google account",
    providerKey: "GOOGLE_WORKSPACE",
    envPrefix: "GOOGLE_GWS",
    connectUrl: "/auth/google/connect",
    connectStart: "/auth/google/connect?proceed=1",
    scopeModel: "scopes",
    launch: "always",
    revokes: true,
    contextHeaders: false,
    runnerRoles: ["sender", "reader"],
  },
  {
    id: "atlassian",
    pluginSlug: "atlassian-mcp",
    displayName: "Atlassian",
    providerName: "Atlassian",
    accountNoun: "Atlassian account",
    providerKey: "ATLASSIAN",
    envPrefix: "ATLASSIAN",
    connectUrl: "/auth/atlassian/connect",
    connectStart: "/auth/atlassian/connect",
    scopeModel: "scopes",
    launch: "always",
    revokes: false,
    contextHeaders: false,
    runnerRoles: ["atlassian"],
  },
  {
    id: "notion",
    pluginSlug: "notion-mcp",
    displayName: "Notion",
    providerName: "Notion",
    accountNoun: "Notion workspace",
    providerKey: "NOTION",
    envPrefix: "NOTION_OAUTH",
    connectUrl: "/auth/notion/connect",
    connectStart: "/auth/notion/connect",
    // Notion grants no scopes: access is the pages the user picks.
    scopeModel: "none",
    launch: "registry",
    revokes: true,
    contextHeaders: false,
    // Two workspaces, mapped by workspace id (SCRUM-366).
    runnerRoles: ["notion", "notionSecond"],
  },
  {
    id: "brevo",
    pluginSlug: "brevo-mcp",
    displayName: "Brevo",
    providerName: "Brevo",
    accountNoun: "Brevo account",
    providerKey: "BREVO",
    envPrefix: "BREVO_OAUTH",
    connectUrl: "/auth/brevo/connect",
    connectStart: "/auth/brevo/connect",
    // Brevo's consent screen does not let the user drop a scope (SCRUM-468).
    scopeModel: "none",
    launch: "registry",
    // Its OAuth app is private to our own Brevo organisation (SCRUM-468).
    audience: "admin",
    revokes: true,
    contextHeaders: false,
    runnerRoles: ["brevo"],
  },
  {
    id: "slack",
    pluginSlug: "slack-mcp",
    displayName: "Slack",
    providerName: "Slack",
    accountNoun: "Slack workspace",
    providerKey: "SLACK",
    envPrefix: "SLACK_CONNECTOR",
    connectUrl: "/auth/slack/connect",
    connectStart: "/auth/slack/connect",
    scopeModel: "scopes",
    launch: "registry",
    // The company workspace only (SCRUM-454).
    audience: "admin",
    revokes: true,
    contextHeaders: false,
    runnerRoles: ["slack"],
  },
  {
    id: "posthog",
    pluginSlug: "posthog-mcp",
    displayName: "PostHog",
    providerName: "PostHog",
    accountNoun: "PostHog project",
    providerKey: "POSTHOG",
    // A metadata-document client: no client secret (SCRUM-471).
    envPrefix: null,
    connectUrl: "/auth/posthog/connect",
    connectStart: "/auth/posthog/connect",
    // Capped by the client metadata document, locked on the consent screen.
    scopeModel: "none",
    launch: "registry",
    // Our own project first (SCRUM-471).
    audience: "admin",
    revokes: true,
    // The regional host and the one granted project.
    contextHeaders: true,
    runnerRoles: ["posthog"],
  },
] as const satisfies readonly ConnectorRecord[];

type Entry = (typeof CONNECTOR_REGISTRY)[number];

export type ConnectorId = Entry["id"];
/** The connectors whose provider can be told to drop a grant. */
export type RevokingConnectorId = Extract<Entry, { revokes: true }>["id"];
/** The connectors whose plugin is handed context headers. */
export type ContextConnectorId = Extract<Entry, { contextHeaders: true }>["id"];

const BY_ID: ReadonlyMap<string, ConnectorRecord> = new Map(CONNECTOR_REGISTRY.map((c) => [c.id, c]));

/** The record for `id`, or undefined for anything that is not a connector. */
export function connectorById(id: string): ConnectorRecord | undefined {
  return BY_ID.get(id);
}

export function isConnectorId(v: unknown): v is ConnectorId {
  return typeof v === "string" && BY_ID.has(v);
}

/** One field of every connector, keyed by id. */
export function byConnector<K extends keyof ConnectorRecord>(field: K): Record<ConnectorId, ConnectorRecord[K]> {
  return Object.fromEntries(CONNECTOR_REGISTRY.map((c) => [c.id, (c as ConnectorRecord)[field]])) as Record<ConnectorId, ConnectorRecord[K]>;
}
