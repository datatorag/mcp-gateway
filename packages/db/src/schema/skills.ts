import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./users";

export const SKILL_VISIBILITIES = ["public", "private"] as const;
export type SkillVisibility = (typeof SKILL_VISIBILITIES)[number];

export const SKILL_ACCOUNTS = ["single", "multiple"] as const;
export type SkillAccounts = (typeof SKILL_ACCOUNTS)[number];

/**
 * The skill catalogue as rows (SCRUM-226): published skills and user-owned
 * skills in ONE table.
 *
 * A published skill has a null owner and `public` visibility, and is seeded
 * from the repo's `content/skills/*.md` at boot, keyed by slug with the
 * content hash as its version; the files stay the authored source and the
 * boundary test runs over them. A user's skill has that user as owner and
 * `private` visibility, a policy value so sharing later is not a migration.
 *
 * Every version is a row. A save inserts a new row for the slug and stamps
 * the previous current row `superseded_at`; the current version is the
 * newest row with neither stamp. A delete stamps `deleted_at` on the
 * current row. `forked_from` pins the slug and version a fork was taken
 * from, so what a user changed is always answerable.
 */
export const skills = pgTable(
  "skills",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Null for a published skill. */
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    visibility: text("visibility").$type<SkillVisibility>().notNull(),
    slug: text("slug").notNull(),
    /** Content hash of the fields that make the skill; equal content is one version. */
    version: text("version").notNull(),
    title: text("title").notNull(),
    situation: text("situation").notNull().default(""),
    produces: text("produces").notNull().default(""),
    tools: jsonb("tools").$type<string[]>().notNull().default([]),
    accounts: text("accounts").$type<SkillAccounts>().notNull().default("single"),
    order: integer("order").notNull().default(99),
    /** Prose above the skill file, markdown. Rendered at read. */
    intro: text("intro").notNull().default(""),
    /** The SKILL.md itself, verbatim: the copy payload and the run payload. */
    source: text("source").notNull(),
    /** Prose below the skill file, markdown. Rendered at read. */
    notes: text("notes").notNull().default(""),
    forkedFromSlug: text("forked_from_slug"),
    forkedFromVersion: text("forked_from_version"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (table) => [
    // EXACTLY ONE CURRENT ROW per owner and slug, enforced by the database:
    // a partial unique index over the living rows. The owner is coalesced
    // so the published rows (null owner) are covered too, since a unique
    // index treats nulls as distinct. History may hold the same version
    // twice (a skill deleted and re-created unchanged); what can never
    // happen is two currents, which is the invariant HQ asked for and the
    // reason every save stamps before it inserts.
    uniqueIndex("skills_current_idx")
      .on(sql`coalesce(${table.ownerId}::text, 'published')`, table.slug)
      .where(sql`superseded_at IS NULL AND deleted_at IS NULL`),
    // The current-version lookup: owner, slug, then the null stamp.
    index("skills_owner_slug_current_idx").on(table.ownerId, table.slug, table.supersededAt),
    index("skills_owner_idx").on(table.ownerId, table.deletedAt, table.supersededAt),
    index("skills_slug_idx").on(table.slug),
  ]
);
