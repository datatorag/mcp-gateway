/**
 * The connectable services, in the shape that is safe to import ANYWHERE —
 * server code included.
 *
 * `services.tsx` used to be the only source, and it cannot serve the server
 * side: it exports React nodes (the brand icons), so importing it from a
 * Mastra tool drags JSX into a module that runs inside the agent runtime. The
 * agent's connect offer (SCRUM-78) needs the same ids, names and connect URLs
 * the dashboard renders, and a second hand-written list would drift the first
 * time a connector is added. So the data half lives here and `services.tsx`
 * decorates it with the icons and capability copy only the dashboard needs.
 */
import { CONNECTOR_REGISTRY, type ConnectorId } from "@/gateway/connectors/registry";

export interface ConnectableService {
  id: ConnectorId;
  name: string;
  /** The Express OAuth route that starts this service's connect flow. */
  connectUrl: string;
  /** The plugin whose registry row launches this service (SCRUM-366). Absent
   * means the service is always offered. Present means every connect surface
   * hides it, and its connect route refuses, until that plugin's
   * `mcp_servers` row exists with status active: a gateway can ship the
   * connect flow before the registry holds the plugin's tools, and a user
   * must never be able to connect a service that has nothing to call. The
   * check is `launchedServiceIds` in `src/gateway/service-launch.ts`. */
  launchPluginSlug?: string;
  /** Who may be offered it (SCRUM-468). `"admin"` offers it to admins only,
   * on every surface and at its connect route, through `serviceOfferedTo`;
   * absent offers it to everyone. Brevo is admin-only while its OAuth app is
   * private to our own Brevo organisation, which nobody else can authorize. */
  audience?: "admin";
}

/** From the connector registry, in its order. `launchPluginSlug` is the
 * plugin of every connector that launches on its registry row, `audience`
 * is copied as it is. */
export const CONNECTABLE_SERVICES: ConnectableService[] = CONNECTOR_REGISTRY.map((c) => ({
  id: c.id,
  name: c.displayName,
  connectUrl: c.connectUrl,
  ...(c.launch === "registry" ? { launchPluginSlug: c.pluginSlug } : {}),
  ...("audience" in c ? { audience: c.audience } : {}),
}));

/** The services offered with no registry check: what a surface shows before
 * it knows which gated services have launched. Never a gated one, so a
 * surface that has not heard back yet fails closed. */
export const ALWAYS_OFFERED_SERVICE_IDS: readonly string[] =
  CONNECTABLE_SERVICES.filter((s) => !s.launchPluginSlug).map((s) => s.id);

/** The services offered to every user once launched: the ids a schema every
 * client sees (the `connect` tool's `service` enum) may name. Never one with
 * an `audience` (Brevo, SCRUM-468; Slack, SCRUM-454): a client's schema is the
 * same for every user, so naming one would announce it to all of them. */
export const PUBLIC_SERVICE_IDS: readonly string[] = CONNECTABLE_SERVICES.filter((s) => !s.audience).map((s) => s.id);

/** The plugins whose service only some users are offered: the
 * `launchPluginSlug` of every entry with an `audience` (Brevo, SCRUM-468;
 * Slack, SCRUM-454). The one list the public surfaces leave out (the status
 * page's tools, the public tool counts, `/tools/<slug>` and the sitemap), so
 * another admin-only service needs no edit there. */
export const ADMIN_AUDIENCE_PLUGIN_SLUGS: readonly string[] = CONNECTABLE_SERVICES.filter(
  (s) => s.audience && s.launchPluginSlug
).map((s) => s.launchPluginSlug!);

/** The entries of `services` a surface may offer, given the launched ids
 * (`launchedServiceIds` on the server, `launchedServices` in the connections
 * view in the browser). Generic so it filters the dashboard's decorated list
 * as well as this one. */
export function offeredServices<T extends ConnectableService>(
  services: readonly T[],
  launched: Iterable<string>
): T[] {
  const ids = new Set(launched);
  return services.filter((s) => !s.launchPluginSlug || ids.has(s.id));
}

export function getConnectableService(
  id: string
): ConnectableService | undefined {
  return CONNECTABLE_SERVICES.find((s) => s.id === id);
}
