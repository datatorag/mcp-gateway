import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";
import { mcpServers } from "./mcp-servers";

export const pluginConnections = pgTable(
  "plugin_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    mcpServerId: uuid("mcp_server_id")
      .notNull()
      .references(() => mcpServers.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    // SCRUM-442: this legacy table is sealed-only. The plain columns stay
    // until the contract migration, nullable and written null.
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    accessTokenSealed: text("access_token_sealed"),
    refreshTokenSealed: text("refresh_token_sealed"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [unique("uq_user_server").on(table.userId, table.mcpServerId)]
);
