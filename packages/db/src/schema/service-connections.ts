import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const serviceConnections = pgTable(
  "service_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    service: text("service").notNull(), // e.g. "google-workspace"
    accessToken: text("access_token").notNull(),
    refreshToken: text("refresh_token"),
    scopes: text("scopes"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  // Every plugin CallTool resolves the user's token by (user_id, service); the
  // dashboard/setup routes scan by user_id alone (covered by the leftmost
  // prefix). Non-unique: a user can hold multiple connections for one service
  // (multi-account), mapped via connected_accounts.
  (table) => [
    index("idx_service_connections_user_service").on(
      table.userId,
      table.service
    ),
  ]
);
