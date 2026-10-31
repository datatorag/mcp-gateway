import { pgTable, text, timestamp, uuid, index } from "drizzle-orm/pg-core";
import { users } from "./users";

// One-click connect links handed out in a conversation (SCRUM-466). The link
// is a credential: only sha256(token) as hex is stored, and a link is spent
// once by a guarded update on `spent_at`.
export const connectLinks = pgTable(
  "connect_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The connector id: google-workspace, atlassian or notion.
    provider: text("provider").notNull(),
    // What issued it: tool_result or elicitation.
    path: text("path").notNull(),
    clientName: text("client_name"),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    spentAt: timestamp("spent_at", { withTimezone: true }),
    // Set when the connect the link started stores its account. Nothing
    // waits on it; it records that the link was used to the end.
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("connect_links_user_idx").on(t.userId)]
);
