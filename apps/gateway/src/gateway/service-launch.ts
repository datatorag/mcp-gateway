import { and, eq, inArray } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers } from "@datatorag-mcp/db";
import {
  ALWAYS_OFFERED_SERVICE_IDS,
  CONNECTABLE_SERVICES,
  getConnectableService,
} from "@/app/dashboard/connections/service-registry";

/**
 * Which connectable services may be offered right now (SCRUM-366).
 *
 * A service whose registry entry names a `launchPluginSlug` is launched when
 * that plugin's `mcp_servers` row exists with status active, which is the same
 * condition the tool listing already joins on: until then the user would
 * connect a service with no tools. Every other service is always launched and
 * costs no query.
 *
 * Read on every surface that offers a connect (the dashboard cards and the
 * agent's empty state through the connections view, the service detail page,
 * the agent's `request_connection`) and by the connect route itself, so a
 * service appears everywhere at once when its row is activated, with no
 * deploy.
 *
 * Fails CLOSED: if the registry cannot be read, the gated services are left
 * out and the others are still offered.
 */
export async function launchedServiceIds(db: Database): Promise<Set<string>> {
  const launched = new Set(ALWAYS_OFFERED_SERVICE_IDS);
  const gated = CONNECTABLE_SERVICES.filter((s) => s.launchPluginSlug);
  if (gated.length === 0) return launched;
  try {
    const rows = await db
      .select({ slug: mcpServers.slug })
      .from(mcpServers)
      .where(
        and(
          eq(mcpServers.status, "active"),
          inArray(
            mcpServers.slug,
            gated.map((s) => s.launchPluginSlug!)
          )
        )
      );
    const active = new Set(rows.map((r) => r.slug));
    for (const s of gated) {
      if (active.has(s.launchPluginSlug!)) launched.add(s.id);
    }
  } catch (err) {
    console.warn(
      "[service-launch] registry read failed, offering ungated services only:",
      err instanceof Error ? err.name : "unknown"
    );
  }
  return launched;
}

/** Whether one service may be offered and connected. False for an id that is
 * not a connectable service. */
export async function isServiceLaunched(
  db: Database,
  serviceId: string
): Promise<boolean> {
  const entry = getConnectableService(serviceId);
  if (!entry) return false;
  if (!entry.launchPluginSlug) return true;
  return (await launchedServiceIds(db)).has(serviceId);
}
