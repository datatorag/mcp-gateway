import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { connectedAccounts } from "./connected-accounts";

/** One row per MCP session start and default account it would use
 * (SCRUM-164), written by one statement at initialize, so the shape alert can
 * ask about a connection rather than a user. Pruned at 90 days, like
 * usage_events. */
export const mcpSessionStarts = pgTable(
  "mcp_session_starts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectedAccountId: uuid("connected_account_id")
      .notNull()
      .references(() => connectedAccounts.id, { onDelete: "cascade" }),
    /** The name the client registered with, cleaned and capped: the client's
     * own claim. */
    clientName: text("client_name"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_mcp_session_starts_account_started").on(table.connectedAccountId, table.startedAt),
  ]
);
