import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { skills, SKILL_ACCOUNTS, type SkillAccounts } from "@datatorag-mcp/db";
import {
  getSkillBySlug,
  readSkillFiles,
  renderSkill,
  setPublishedSnapshot,
  skillVersion,
  type Skill,
  type SkillContent,
  type SkillReader,
} from "@/lib/skills";
import { REGISTRY_TOOL_NAMES } from "../playground/registry-snapshot";
import { echoName } from "../skills-catalogue";

/**
 * The skill catalogue as rows (SCRUM-226): seeding, reading, and a user's
 * writes. One table, `skills`, with published rows (null owner) and a
 * user's rows beside them; every read is one query filtered by owner and
 * visibility; every save is a new immutable version.
 */

/** A bound on the store, not a plan feature: skills are free on every plan
 * (per HQ decision). The error names the number. */
export const USER_SKILL_CAP = 50;

export const LIMITS = {
  title: 200,
  situation: 2_000,
  produces: 2_000,
  source: 32_768,
  tools: 40,
} as const;

/** Strings that must never be saved into a skill: a key or a connection
 * string pasted into a skill file would run under every reader of the
 * thread and sit in a table. The same shapes the security gate greps for. */
const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\bsk_(live|test)_[A-Za-z0-9]{8,}/,
  /\bxox[abprs]-[A-Za-z0-9-]{8,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./,
  /\bpostgres(ql)?:\/\/[^\s:]+:[^\s@]+@/,
  /\bhooks\.slack\.com\/services\//,
];

export type SkillInput = Pick<SkillContent, "title" | "situation" | "produces" | "tools" | "accounts"> & {
  source: string;
};

export type Validation =
  | { ok: true; value: SkillInput }
  | { ok: false; field: keyof SkillInput | "body"; error: string };

function str(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t.length > max ? null : t;
}

/** Mechanical validation at save (per HQ decision): sizes, shipped tools,
 * the accounts enum, a secret scan. Meaning is not validated: a user's
 * skill is private to them and runs with their own tokens. */
export function validateSkillInput(body: unknown): Validation {
  if (!body || typeof body !== "object") return { ok: false, field: "body", error: "body must be an object" };
  const b = body as Record<string, unknown>;
  const title = str(b.title, LIMITS.title);
  if (!title) return { ok: false, field: "title", error: `title is required, at most ${LIMITS.title} characters` };
  const situation = str(b.situation ?? "", LIMITS.situation);
  if (situation === null) return { ok: false, field: "situation", error: `at most ${LIMITS.situation} characters` };
  const produces = str(b.produces ?? "", LIMITS.produces);
  if (produces === null) return { ok: false, field: "produces", error: `at most ${LIMITS.produces} characters` };
  const source = typeof b.source === "string" ? b.source : null;
  if (!source || !source.trim()) return { ok: false, field: "source", error: "the skill file is required" };
  if (source.length > LIMITS.source) {
    return { ok: false, field: "source", error: `the skill file is at most ${LIMITS.source} characters` };
  }
  if (SECRET_PATTERNS.some((p) => p.test(source))) {
    return { ok: false, field: "source", error: "the skill file contains something that looks like a secret" };
  }
  if (!Array.isArray(b.tools) || b.tools.length === 0 || b.tools.length > LIMITS.tools) {
    return { ok: false, field: "tools", error: `tools must name 1 to ${LIMITS.tools} tools` };
  }
  const tools: string[] = [];
  for (const t of b.tools) {
    if (typeof t !== "string" || !REGISTRY_TOOL_NAMES.has(t)) {
      return { ok: false, field: "tools", error: `unknown tool: ${echoName(t) || "?"}` };
    }
    if (!tools.includes(t)) tools.push(t);
  }
  const accounts = b.accounts ?? "single";
  if (!(SKILL_ACCOUNTS as readonly unknown[]).includes(accounts)) {
    return { ok: false, field: "accounts", error: "accounts must be single or multiple" };
  }
  return {
    ok: true,
    value: { title, situation, produces, source, tools, accounts: accounts as SkillAccounts },
  };
}

/** A slug from a title, with a numeric suffix on collision against the
 * owner's own current slugs. The product name is dropped so a fork of
 * "... with Claude" does not carry it. */
export function slugFromTitle(title: string, taken: ReadonlySet<string>): string {
  const base =
    title
      .replace(/\s+with Claude\.?$/i, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "") || "skill";
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
}

type Row = typeof skills.$inferSelect;

function rowToSkill(row: Row): Skill {
  return renderSkill({
    slug: row.slug,
    owner: row.ownerId,
    layer: row.ownerId ? "yours" : "published",
    version: row.version,
    forkedFrom:
      row.forkedFromSlug && row.forkedFromVersion
        ? { slug: row.forkedFromSlug, version: row.forkedFromVersion }
        : null,
    title: row.title,
    situation: row.situation,
    produces: row.produces,
    tools: row.tools,
    accounts: row.accounts,
    order: row.order,
    intro: row.intro,
    skillSource: row.source,
    notes: row.notes,
  });
}

const current = and(isNull(skills.supersededAt), isNull(skills.deletedAt));

/** Published rows plus the viewer's own, the viewer's winning a slug,
 * ordered as the files are (order, then slug). */
export async function listForViewer(db: Database, viewer: string | null): Promise<Skill[]> {
  const who = viewer === null ? isNull(skills.ownerId) : or(isNull(skills.ownerId), eq(skills.ownerId, viewer));
  const rows = await db
    .select()
    .from(skills)
    .where(and(current, who))
    .orderBy(asc(skills.order), asc(skills.slug));
  const bySlug = new Map<string, Row>();
  for (const row of rows) {
    const existing = bySlug.get(row.slug);
    if (!existing || (existing.ownerId === null && row.ownerId !== null)) bySlug.set(row.slug, row);
  }
  return [...bySlug.values()].map(rowToSkill);
}

export async function findForViewer(db: Database, viewer: string | null, slug: string): Promise<Skill | null> {
  const who = viewer === null ? isNull(skills.ownerId) : or(isNull(skills.ownerId), eq(skills.ownerId, viewer));
  const rows = await db
    .select()
    .from(skills)
    .where(and(current, who, eq(skills.slug, slug)))
    .limit(2);
  const own = rows.find((r) => r.ownerId !== null);
  const row = own ?? rows[0];
  return row ? rowToSkill(row) : null;
}

export function skillReader(db: Database): SkillReader {
  return {
    listForViewer: (viewer) => listForViewer(db, viewer),
    findForViewer: (viewer, slug) => findForViewer(db, viewer, slug),
  };
}

async function currentUserRow(db: Database, owner: string, slug: string): Promise<Row | null> {
  const [row] = await db
    .select()
    .from(skills)
    .where(and(current, eq(skills.ownerId, owner), eq(skills.slug, slug)))
    .limit(1);
  return row ?? null;
}

async function currentUserSlugs(db: Database, owner: string): Promise<Set<string>> {
  const rows = await db
    .select({ slug: skills.slug })
    .from(skills)
    .where(and(current, eq(skills.ownerId, owner)));
  return new Set(rows.map((r) => r.slug));
}

/* ---------------------------------------------------------------------- */
/* Seeding: the files are the authored source for published skills         */
/* ---------------------------------------------------------------------- */

/** Upsert every published file as a public row keyed by slug with the
 * content hash as version. Unchanged: nothing. Changed: a new version,
 * the old one superseded. Gone: the current row retired. Warms the
 * in-process snapshot so the first request never waits. */
export async function seedPublishedSkills(
  db: Database,
  files: Skill[] = readSkillFiles()
): Promise<{ inserted: number; unchanged: number; retired: number }> {
  const rows = await db.select().from(skills).where(and(current, isNull(skills.ownerId)));
  const bySlug = new Map(rows.map((r) => [r.slug, r]));
  const now = new Date();
  let inserted = 0;
  let unchanged = 0;
  let retired = 0;

  for (const file of files) {
    const existing = bySlug.get(file.slug);
    bySlug.delete(file.slug);
    // The version is computed from the content here, never trusted from the
    // input, so the hash and the row can never disagree.
    const version = skillVersion(file);
    if (existing && existing.version === version) {
      unchanged += 1;
      continue;
    }
    await db.transaction(async (tx) => {
      if (existing) {
        await tx.update(skills).set({ supersededAt: now }).where(eq(skills.id, existing.id));
      }
      await tx.insert(skills).values({
        ownerId: null,
        visibility: "public",
        slug: file.slug,
        version,
        title: file.title,
        situation: file.situation,
        produces: file.produces,
        tools: file.tools,
        accounts: file.accounts,
        order: file.order,
        intro: file.intro,
        source: file.skillSource,
        notes: file.notes,
        createdAt: now,
      });
    });
    inserted += 1;
  }
  for (const gone of bySlug.values()) {
    await db.update(skills).set({ deletedAt: now }).where(eq(skills.id, gone.id));
    retired += 1;
  }

  setPublishedSnapshot(await listForViewer(db, null));
  return { inserted, unchanged, retired };
}

/* ---------------------------------------------------------------------- */
/* A user's writes                                                          */
/* ---------------------------------------------------------------------- */

export type WriteResult =
  | { ok: true; skill: Skill }
  | { ok: false; reason: "invalid"; field: string; error: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "exists" }
  | { ok: false; reason: "cap"; cap: number };

function contentOf(input: SkillInput, order = 99, intro = "", notes = ""): SkillContent {
  return {
    title: input.title,
    situation: input.situation,
    produces: input.produces,
    tools: input.tools,
    accounts: input.accounts,
    order,
    intro,
    skillSource: input.source,
    notes,
  };
}

async function atCap(db: Database, owner: string): Promise<boolean> {
  const [row] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(skills)
    .where(and(current, eq(skills.ownerId, owner)));
  return (row?.n ?? 0) >= USER_SKILL_CAP;
}

async function insertUserRow(
  db: Database,
  owner: string,
  slug: string,
  c: SkillContent,
  forkedFrom: { slug: string; version: string } | null,
  now: Date
): Promise<Skill> {
  const [row] = await db
    .insert(skills)
    .values({
      ownerId: owner,
      visibility: "private",
      slug,
      version: skillVersion(c),
      title: c.title,
      situation: c.situation,
      produces: c.produces,
      tools: c.tools,
      accounts: c.accounts,
      order: c.order,
      intro: c.intro,
      source: c.skillSource,
      notes: c.notes,
      forkedFromSlug: forkedFrom?.slug ?? null,
      forkedFromVersion: forkedFrom?.version ?? null,
      createdAt: now,
    })
    .returning();
  return rowToSkill(row!);
}

export async function createUserSkill(db: Database, owner: string, body: unknown): Promise<WriteResult> {
  const v = validateSkillInput(body);
  if (!v.ok) return { ok: false, reason: "invalid", field: v.field, error: v.error };
  if (await atCap(db, owner)) return { ok: false, reason: "cap", cap: USER_SKILL_CAP };
  const slug = slugFromTitle(v.value.title, await currentUserSlugs(db, owner));
  const skill = await insertUserRow(db, owner, slug, contentOf(v.value), null, new Date());
  return { ok: true, skill };
}

/** A new immutable version of the owner's skill: stamp the current row,
 * insert the next, in one transaction, so no reader ever sees two currents.
 * Identical content is not a new version. */
export async function updateUserSkill(
  db: Database,
  owner: string,
  slug: string,
  body: unknown
): Promise<WriteResult> {
  const v = validateSkillInput(body);
  if (!v.ok) return { ok: false, reason: "invalid", field: v.field, error: v.error };
  const existing = await currentUserRow(db, owner, slug);
  if (!existing) return { ok: false, reason: "not_found" };
  const c = contentOf(v.value, existing.order, existing.intro, existing.notes);
  if (skillVersion(c) === existing.version) return { ok: true, skill: rowToSkill(existing) };
  const forkedFrom =
    existing.forkedFromSlug && existing.forkedFromVersion
      ? { slug: existing.forkedFromSlug, version: existing.forkedFromVersion }
      : null;
  const now = new Date();
  const skill = await db.transaction(async (tx) => {
    await tx.update(skills).set({ supersededAt: now }).where(eq(skills.id, existing.id));
    return insertUserRow(tx as unknown as Database, owner, slug, c, forkedFrom, now);
  });
  return { ok: true, skill };
}

/** A copy of the current published version into the caller's namespace,
 * same slug, `forked_from` pinned, so it shadows the original for them. */
export async function forkSkill(db: Database, owner: string, slug: string): Promise<WriteResult> {
  // The published skill as every surface sees it (the snapshot, the files
  // before the seeder has run), never only the table: the version is the
  // content hash either way, so forked_from pins the same thing.
  const published = await getSkillBySlug(slug, null);
  if (!published) return { ok: false, reason: "not_found" };
  if (await currentUserRow(db, owner, slug)) return { ok: false, reason: "exists" };
  if (await atCap(db, owner)) return { ok: false, reason: "cap", cap: USER_SKILL_CAP };
  const c: SkillContent = {
    title: published.title,
    situation: published.situation,
    produces: published.produces,
    tools: published.tools,
    accounts: published.accounts,
    order: published.order,
    intro: published.intro,
    skillSource: published.skillSource,
    notes: published.notes,
  };
  const skill = await insertUserRow(
    db,
    owner,
    slug,
    c,
    { slug: published.slug, version: published.version },
    new Date()
  );
  return { ok: true, skill };
}

/** Stamp the owner's current row. Says whether a published skill was being
 * shadowed, so the confirmation can say the published one comes back. */
export async function deleteUserSkill(
  db: Database,
  owner: string,
  slug: string
): Promise<{ slug: string; shadowed: boolean } | null> {
  const existing = await currentUserRow(db, owner, slug);
  if (!existing) return null;
  await db.update(skills).set({ deletedAt: new Date() }).where(eq(skills.id, existing.id));
  const published = await getSkillBySlug(slug, null);
  return { slug, shadowed: published !== null };
}
