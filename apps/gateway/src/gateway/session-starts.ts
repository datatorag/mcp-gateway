import { sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { cleanClientName } from "./untrusted-text";

/**
 * Record an MCP session start against the accounts it would use (SCRUM-164).
 *
 * ONE statement per session: a row for each service's default account, which
 * is the account every call without an `account` argument resolves to. A user
 * with no connection writes no row. Called fire-and-forget from initialize;
 * never throws, so a failed insert never delays or fails the handshake.
 */
export async function recordSessionStart(
  db: Database,
  userId: string,
  clientName: string | undefined
): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO mcp_session_starts (user_id, connected_account_id, client_name)
      SELECT user_id, id, ${cleanClientName(clientName)}
      FROM connected_accounts
      WHERE user_id = ${userId} AND is_default
    `);
  } catch (err) {
    console.warn(`[session-starts] record failed for user=${userId}`, err);
  }
}

/** One connection whose sessions kept opening with no tool call behind them. */
export type QuietConnection = {
  userId: string;
  connectorType: string;
  accountEmail: string;
  daysWithSessions: number;
  sessions: number;
  lastRefreshAt: Date | null;
  lastRefreshError: string | null;
  refreshPermanentFailures: number;
};

/**
 * The shape alert (SCRUM-164), for the daily routine: default accounts with
 * sessions on at least `days - 1` of the last `days` days (and at least one)
 * and no tool call on that account in the window. A row whose refresh health
 * says dead (`connectionDead`) is broken and an outreach trigger; one with no
 * refresh error is quiet, or stuck in the client.
 *
 * Selects no token column. Its output names accounts, so it belongs in the
 * internal routine only. Internal accounts are excluded by the routine, the
 * way it already excludes them.
 */
export async function quietConnections(db: Database, days = 3): Promise<QuietConnection[]> {
  const rows = await db.execute<{
    user_id: string;
    connector_type: string;
    account_email: string;
    days_with_sessions: number;
    sessions: number;
    last_refresh_at: string | Date | null;
    last_refresh_error: string | null;
    refresh_permanent_failures: number;
  }>(sql`
    WITH starts AS (
      SELECT connected_account_id,
             count(DISTINCT started_at::date)::int AS days_with_sessions,
             count(*)::int AS sessions
      FROM mcp_session_starts
      WHERE started_at >= now() - make_interval(days => ${days})
      GROUP BY connected_account_id
    )
    SELECT ca.user_id, ca.connector_type, ca.account_email, s.days_with_sessions, s.sessions,
           sc.last_refresh_at, sc.last_refresh_error, sc.refresh_permanent_failures
    FROM starts s
    JOIN connected_accounts ca ON ca.id = s.connected_account_id
    JOIN service_connections sc ON sc.id = ca.service_connection_id
    WHERE s.days_with_sessions >= greatest(${days} - 1, 1)
      AND NOT EXISTS (
        SELECT 1 FROM usage_events ue
        WHERE ue.user_id = ca.user_id
          AND ue.connector = ca.connector_type
          AND ue.account_email = ca.account_email
          AND ue.created_at >= now() - make_interval(days => ${days})
      )
  `);
  return [...rows].map((r) => ({
    userId: r.user_id,
    connectorType: r.connector_type,
    accountEmail: r.account_email,
    daysWithSessions: Number(r.days_with_sessions),
    sessions: Number(r.sessions),
    lastRefreshAt: r.last_refresh_at === null ? null : new Date(r.last_refresh_at),
    lastRefreshError: r.last_refresh_error,
    refreshPermanentFailures: Number(r.refresh_permanent_failures),
  }));
}
