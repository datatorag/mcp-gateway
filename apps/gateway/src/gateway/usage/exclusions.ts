import { isNotNull, sql, type SQL } from "drizzle-orm";
import { usageEvents } from "@datatorag-mcp/db";

/**
 * Rows the customer-facing usage views must leave out, stated ONCE.
 *
 * WHAT THESE ROWS ARE. For a short window, agent tool calls were metered from
 * the UI message stream, which can see a tool's name and nothing else. Those
 * rows landed in `usage_events` with a null connector, a zero latency and no
 * response size. `usage_events` has no surface column, so nothing distinguishes
 * them from gateway traffic once written, and every by-connector and latency
 * view read them as real.
 *
 * WHY NOT BACKFILL. Because there is nothing to backfill FROM. The connector
 * could be recovered from the tool name, but the latency and the response size
 * were never measured; inventing them would put fabricated numbers into a table
 * a customer reads, which is worse than a gap. A row that says nothing is
 * honest. A row that says 340ms because someone picked 340 is not.
 *
 * WHY THIS SURVIVES ITS OWN FIX. Metering now wraps the tool's `execute`
 * (`mastra/mcp/client.ts`), so new agent rows carry a real connector and a real
 * duration and are not matched here. The predicate is therefore about a bounded
 * set of historical rows and will not grow. It is kept rather than turned into
 * a one-off cleanup because deleting a user's usage history to tidy a metric is
 * a worse trade than filtering it.
 *
 * The condition is deliberately NOT "connector is null OR latency = 0": a
 * genuine sub-millisecond call would round to zero and must keep counting.
 * A missing connector is the thing that identifies these rows.
 */

/** Rows that can be attributed to a connector. For a view that GROUPS BY
 * connector, where a row without one has nowhere to go.
 *
 * Correct for that view whatever the cause: a future plugin with no entry in
 * PLUGIN_SERVICE_MAP would also report a null connector, and it too has no
 * bucket in a per-connector breakdown. */
export const ATTRIBUTABLE_ROWS: SQL = isNotNull(usageEvents.connector);

/**
 * Rows whose latency was actually measured, as an aggregate FILTER.
 *
 * WHY THIS IS SEPARATE FROM THE WHERE CLAUSE, and it is the whole point:
 * these calls really happened. The user made them and they should be COUNTED.
 * Only their duration is unknown. Filtering the whole query would silently
 * reduce someone's call total to make a latency chart tidier, which trades a
 * cosmetic problem for a wrong number on the figure people actually check.
 *
 * WHY IT IS NOT SIMPLY "connector is not null", which is what it was first
 * written as: that conflates two different questions. "Has no connector" is a
 * permanent, legitimate property of any plugin missing from PLUGIN_SERVICE_MAP,
 * and such a call would be metered correctly, with a real duration. Keyed on
 * the connector alone, every one of those would be dropped from latency stats
 * forever, silently, for a reason nobody would think to look for.
 *
 * So this matches the BUG'S SIGNATURE instead: the stream tap set none of the
 * three fields it could not see. All three being unset together is what
 * identifies those rows, and a genuine call does not look like that — a real
 * response has a size even when it is fast.
 */
export const MEASURED_LATENCY_FILTER: SQL = sql`filter (where not (
  ${usageEvents.connector} is null
  and ${usageEvents.latencyMs} = 0
  and ${usageEvents.responseSizeBytes} is null
))`;
