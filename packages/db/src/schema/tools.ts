import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { mcpServers } from "./mcp-servers";

export const tools = pgTable("tools", {
  id: uuid("id").primaryKey().defaultRandom(),
  mcpServerId: uuid("mcp_server_id")
    .notNull()
    .references(() => mcpServers.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  namespacedName: text("namespaced_name").notNull().unique(),
  description: text("description"),
  inputSchemaJson: jsonb("input_schema_json"),
  // MCP tool annotation captured at discovery: true = declared read-only,
  // false = declared mutating, null = the plugin didn't annotate it. Drives
  // the playground write-confirmation gate (falls back to a name heuristic
  // when null). See apps/gateway/src/gateway/playground/tools.ts.
  readOnlyHint: boolean("read_only_hint"),
  creditsPerCall: integer("credits_per_call").notNull().default(1),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});
