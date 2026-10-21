import {
  boolean,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "./users";
import { serviceConnections } from "./service-connections";

export const connectedAccounts = pgTable(
  "connected_accounts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    connectorType: text("connector_type").notNull(), // "google-workspace", "atlassian"
    label: text("label"), // display label: "work", "personal"
    accountEmail: text("account_email").notNull(), // routing key
    // The provider's own id for what one grant covers, where one login can
    // hold several: a Notion workspace id. Null for Google and Atlassian, so
    // their rows stay unique on (user, connector, email) exactly as before
    // (SCRUM-366).
    externalAccountId: text("external_account_id"),
    serviceConnectionId: uuid("service_connection_id")
      .notNull()
      .references(() => serviceConnections.id, { onDelete: "cascade" }),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // NULLS NOT DISTINCT: a null external id counts as one value, so two
    // Google rows with the same email still collide; two Notion workspaces
    // under one email do not.
    unique("uq_user_connector_email_external")
      .on(
        table.userId,
        table.connectorType,
        table.accountEmail,
        table.externalAccountId
      )
      .nullsNotDistinct(),
  ]
);
