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
  // false = declared mutating, null = the plugin didn't annotate it.
  //
  // RECORDED, NOT TRUSTED. This does NOT drive the write-confirmation gate and
  // must never be made to — a plugin server controls its own annotations, so a
  // compromised or careless one could declare a delete tool read-only and skip
  // the user's approval. `classifyWrite` decides from the tool NAME alone,
  // against source-controlled lists, and fails closed on anything it does not
  // recognise. See apps/gateway/src/gateway/playground/tools.ts.
  //
  // What this column is for: a cross-check. A test asserts our classification
  // and the plugin's own declaration agree, so the next divergence surfaces in
  // a diff instead of quietly widening what runs unasked.
  //
  // (This comment previously said it drove the gate. It did, before the
  // refactor that removed that trust deliberately. A stale comment about a
  // security property is worse than none: it makes the next reader mis-price
  // the risk, which is exactly what it did.)
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
