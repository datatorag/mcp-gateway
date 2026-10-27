import { eq, and, notInArray } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { serviceConnections, connectedAccounts } from "@datatorag-mcp/db";
import { listConnectedAccounts } from "./connected-accounts";
import { connectorGrantsScopes, scopeDelta, serviceGrantStates } from "./scope-grant";
import { launchedServiceIds } from "./service-launch";
import { connectionDead } from "./refresh-failure";
import type {
  ConnectedAccount,
  LegacyConnection,
} from "@/app/dashboard/connections/types";

/** What the dashboard renders about a user's connections: the migrated
 * account rows and any legacy service rows not yet migrated, each with its
 * finished grant delta. */
export interface ConnectionsView {
  accounts: ConnectedAccount[];
  connections: LegacyConnection[];
  /** The connectable service ids this gateway may offer right now
   * (SCRUM-366, `service-launch.ts`). Every client surface that lists
   * services to connect filters by it, through `offeredServices`. */
  launchedServices: string[];
}

/** The finished grant answer for one row, in the shape consumers render
 * (SCRUM-136 + SCRUM-106). Both halves come out of scope-grant.ts, so the
 * account rows and the legacy rows cannot describe the same grant two
 * different ways. */
function scopeStatusFor(service: string, scopes: string | null) {
  const { missing, complete } = scopeDelta(service, scopes);
  return {
    missing,
    complete,
    services: serviceGrantStates(service, scopes),
    scoped: connectorGrantsScopes(service),
  };
}

/** The refresh health for one row (SCRUM-190), from the same rule the token
 * path uses, so the screen and the model cannot disagree about a dead grant. */
function refreshStatusFor(
  service: string,
  row: { lastRefreshError: string | null; refreshPermanentFailures: number }
) {
  return { needsReconnect: connectionDead(service, row), lastError: row.lastRefreshError };
}

/**
 * ONE loader for the connection state, serving both `/api/connections` and
 * the Agent page's server render (SCRUM-206).
 *
 * The page is a server component that already holds the user's id, so it
 * answers "what is connected" at render time instead of asking the browser
 * to go and find out after first paint. The client hook then starts from
 * this truth and keeps its own fetch only for refetch-after-change. Both
 * callers run THIS function, so the shape the page hands down and the shape
 * the browser fetches later cannot drift.
 *
 * Returned through a JSON round trip on purpose: the API route serialises
 * dates to strings, the client types say string, and a server component
 * passing this straight into a client component must hand over exactly what
 * the browser would otherwise have parsed.
 */
export async function loadConnectionsView(
  db: Database,
  userId: string
): Promise<ConnectionsView> {
  // TWO STATEMENTS, ONE ROUND TRIP'S WORTH OF WAITING. The legacy query used
  // to wait for the account rows so it could exclude their service ids in
  // JavaScript; the exclusion is now a subquery, so the two run concurrently
  // and the page's first byte pays for the slower one, not the sum. The
  // service-id column is NOT NULL, so NOT IN over the subquery is safe (a
  // NULL in a NOT IN list would empty the result).
  const [rawAccounts, legacyConnections, launched] = await Promise.all([
    listConnectedAccounts(db, userId),
    db
      .select({
        id: serviceConnections.id,
        service: serviceConnections.service,
        scopes: serviceConnections.scopes,
        connectedAt: serviceConnections.connectedAt,
        lastRefreshError: serviceConnections.lastRefreshError,
        refreshPermanentFailures: serviceConnections.refreshPermanentFailures,
      })
      .from(serviceConnections)
      .where(
        and(
          eq(serviceConnections.userId, userId),
          // Legacy: un-migrated service_connections (no connected_accounts
          // row pointing at them yet).
          notInArray(
            serviceConnections.id,
            db
              .select({ id: connectedAccounts.serviceConnectionId })
              .from(connectedAccounts)
              .where(eq(connectedAccounts.userId, userId))
          )
        )
      ),
    launchedServiceIds(db),
  ]);

  // SCRUM-136 (the SCRUM-105 shape): callers get the finished DELTA, not a
  // scope array to re-derive "is this enough" from.
  // The raw refresh columns become `refresh`, the finished answer, the same
  // way scopes become `scopeStatus`.
  const accounts = rawAccounts.map(({ lastRefreshError, refreshPermanentFailures, ...a }) => ({
    ...a,
    scopeStatus: scopeStatusFor(a.connectorType, a.scopes),
    refresh: refreshStatusFor(a.connectorType, { lastRefreshError, refreshPermanentFailures }),
  }));

  const connections = legacyConnections.map(({ lastRefreshError, refreshPermanentFailures, ...c }) => ({
    ...c,
    scopeStatus: scopeStatusFor(c.service, c.scopes),
    refresh: refreshStatusFor(c.service, { lastRefreshError, refreshPermanentFailures }),
  }));

  return JSON.parse(
    JSON.stringify({ accounts, connections, launchedServices: [...launched] })
  ) as ConnectionsView;
}
