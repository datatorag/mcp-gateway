import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const TEAM_SIZE_VALUES = ["1-10", "11-50", "51-200", "201-1000", "1000+"] as const;
export type TeamSize = (typeof TEAM_SIZE_VALUES)[number];

export const leads = pgTable(
  "leads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    email: text("email").notNull(),
    company: text("company").notNull(),
    teamSize: text("team_size").$type<TeamSize>(),
    useCase: text("use_case"),
    utmSource: text("utm_source"),
    utmMedium: text("utm_medium"),
    utmCampaign: text("utm_campaign"),
    utmTerm: text("utm_term"),
    utmContent: text("utm_content"),
    referrer: text("referrer"),
    ipHash: text("ip_hash"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("idx_leads_created_at").on(table.createdAt.desc()),
    index("idx_leads_email").on(table.email),
  ]
);
