import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { skills } from "@datatorag-mcp/db";
import { getTestDb, insertTestUser, isDockerAvailable, stopTestDb } from "@/test-utils/db";
import { readSkillFiles, skillVersion } from "@/lib/skills";
import {
  USER_SKILL_CAP,
  createUserSkill,
  deleteUserSkill,
  findForViewer,
  forkSkill,
  listForViewer,
  seedPublishedSkills,
  slugFromTitle,
  updateUserSkill,
  validateSkillInput,
} from "./catalogue-store";

/* SCRUM-226: the skill catalogue as rows. The published files are seeded
 * as public rows; a user's skills are private rows beside them; every read
 * is one query filtered by owner and visibility; every save is a new
 * immutable version. The invariant HQ asked for is pinned on real
 * Postgres: exactly one current row per (owner, slug) among the living. */

const VALID = {
  title: "Sweep my drafts folder with Claude",
  situation: "My drafts pile up and I never send or delete them.",
  produces: "A list of drafts older than a week, each sent or deleted on my say-so.",
  tools: ["gmail_list", "gmail_read", "gmail_delete_draft"],
  accounts: "single" as const,
  source: "---\nname: draft-sweep\n---\n# Draft sweep\n\nList drafts older than seven days with gmail_list, read each with gmail_read, and ask before gmail_delete_draft.\n",
};

describe("validateSkillInput (pure)", () => {
  it("accepts a well-formed skill and normalises the shape", () => {
    const r = validateSkillInput(VALID);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.tools).toEqual(VALID.tools);
  });

  it("refuses an unshipped tool, an oversize source, a bad accounts value and a missing title", () => {
    expect(validateSkillInput({ ...VALID, tools: ["gmail_teleport"] })).toMatchObject({ ok: false, field: "tools" });
    expect(validateSkillInput({ ...VALID, source: "x".repeat(40_000) })).toMatchObject({ ok: false, field: "source" });
    expect(validateSkillInput({ ...VALID, accounts: "all" })).toMatchObject({ ok: false, field: "accounts" });
    expect(validateSkillInput({ ...VALID, title: "" })).toMatchObject({ ok: false, field: "title" });
    expect(validateSkillInput(null).ok).toBe(false);
  });

  it("refuses a source that carries a secret-shaped string", () => {
    for (const secret of [
      "-----BEGIN PRIVATE KEY-----",
      "sk_live_abcdefghijklmnop",
      "xoxb-1234567890-abcdefghij",
      "AKIAABCDEFGHIJKLMNOP",
      "postgres://user:password@host/db",
    ]) {
      expect(validateSkillInput({ ...VALID, source: `${VALID.source}\n${secret}\n` })).toMatchObject({
        ok: false,
        field: "source",
      });
    }
  });
});

describe("slugFromTitle (pure)", () => {
  it("derives a slug from the title and suffixes on collision", () => {
    expect(slugFromTitle("Sweep my drafts folder with Claude", new Set())).toBe("sweep-my-drafts-folder");
    expect(slugFromTitle("Sweep my drafts folder", new Set(["sweep-my-drafts-folder"]))).toBe("sweep-my-drafts-folder-2");
    expect(slugFromTitle("!!!", new Set())).toBe("skill");
  });
});

describe("skillVersion (pure)", () => {
  it("is a content hash: same content same version, any field change a new one", () => {
    const a = skillVersion(VALID);
    expect(a).toBe(skillVersion({ ...VALID }));
    expect(skillVersion({ ...VALID, produces: VALID.produces + "!" })).not.toBe(a);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });
});

const docker = isDockerAvailable();

describe.skipIf(!docker)("the catalogue store (real Postgres)", () => {
  let db: Database;
  let owner: string;
  let stranger: string;

  beforeAll(async () => {
    db = await getTestDb();
    owner = await insertTestUser(db);
    stranger = await insertTestUser(db);
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  async function currentRows(ownerId: string | null) {
    const ownerCond = ownerId === null ? isNull(skills.ownerId) : eq(skills.ownerId, ownerId);
    return db
      .select({ slug: skills.slug, n: sql<number>`count(*)::int` })
      .from(skills)
      .where(and(ownerCond, isNull(skills.supersededAt), isNull(skills.deletedAt)))
      .groupBy(skills.slug);
  }

  it("seeds every published file as a public row with the content hash as version, and is idempotent", async () => {
    const files = readSkillFiles();
    const first = await seedPublishedSkills(db);
    expect(first).toEqual({ inserted: files.length, unchanged: 0, retired: 0 });
    const second = await seedPublishedSkills(db);
    expect(second).toEqual({ inserted: 0, unchanged: files.length, retired: 0 });
    const published = await listForViewer(db, null);
    expect(published.map((s) => s.slug)).toEqual(files.map((f) => f.slug));
    const brief = published.find((s) => s.slug === "morning-brief")!;
    expect(brief.layer).toBe("published");
    expect(brief.version).toBe(files.find((f) => f.slug === "morning-brief")!.version);
    expect(brief.skillSource).toBe(files.find((f) => f.slug === "morning-brief")!.skillSource);
    expect(brief.introHtml).toContain("<");
  });

  it("a changed file is a new version and the old row is superseded; a vanished file is retired", async () => {
    const files = readSkillFiles();
    const changed = files.map((f) =>
      f.slug === "morning-brief" ? { ...f, produces: f.produces + " (edited)" } : f
    );
    const r = await seedPublishedSkills(db, changed.filter((f) => f.slug !== "week-ahead"));
    expect(r).toEqual({ inserted: 1, unchanged: files.length - 2, retired: 1 });
    const rows = await currentRows(null);
    expect(rows.find((x) => x.slug === "week-ahead")).toBeUndefined();
    expect(rows.every((x) => x.n === 1)).toBe(true);
    // Back to the files: the retired one returns as a fresh version, the
    // edited one gets its file content back as a new version.
    const back = await seedPublishedSkills(db, files);
    expect(back.inserted).toBe(2);
  });

  it("a user creates a skill, sees it beside the published ones, and a stranger does not", async () => {
    const created = await createUserSkill(db, owner, VALID);
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.skill).toMatchObject({ slug: "sweep-my-drafts-folder", layer: "yours", owner });
    const mine = await listForViewer(db, owner);
    expect(mine.map((s) => s.slug)).toContain("sweep-my-drafts-folder");
    expect(mine.filter((s) => s.layer === "published").length).toBe(readSkillFiles().length);
    const theirs = await listForViewer(db, stranger);
    expect(theirs.map((s) => s.slug)).not.toContain("sweep-my-drafts-folder");
    expect(await findForViewer(db, stranger, "sweep-my-drafts-folder")).toBeNull();
    expect(await findForViewer(db, null, "sweep-my-drafts-folder")).toBeNull();
  });

  it("an update is a new immutable version; the previous row is superseded, never edited", async () => {
    const before = (await findForViewer(db, owner, "sweep-my-drafts-folder"))!;
    const updated = await updateUserSkill(db, owner, "sweep-my-drafts-folder", { ...VALID, produces: "Something else." });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.skill.version).not.toBe(before.version);
    const rows = await db
      .select()
      .from(skills)
      .where(and(eq(skills.ownerId, owner), eq(skills.slug, "sweep-my-drafts-folder")));
    expect(rows).toHaveLength(2);
    const old = rows.find((r) => r.version === before.version)!;
    expect(old.supersededAt).not.toBeNull();
    expect(old.produces).toBe(VALID.produces);
    // An update with identical content is not a new version.
    const same = await updateUserSkill(db, owner, "sweep-my-drafts-folder", { ...VALID, produces: "Something else." });
    expect(same.ok && same.skill.version).toBe(updated.skill.version);
    expect((await currentRows(owner)).every((x) => x.n === 1)).toBe(true);
  });

  it("a stranger cannot update or delete another user's skill", async () => {
    expect(await updateUserSkill(db, stranger, "sweep-my-drafts-folder", VALID)).toEqual({ ok: false, reason: "not_found" });
    expect(await deleteUserSkill(db, stranger, "sweep-my-drafts-folder")).toBeNull();
  });

  it("a fork keeps the published slug, pins forked_from, and shadows the published one for its owner only", async () => {
    const forked = await forkSkill(db, owner, "morning-brief");
    expect(forked.ok).toBe(true);
    if (!forked.ok) return;
    const published = (await findForViewer(db, null, "morning-brief"))!;
    expect(forked.skill).toMatchObject({
      slug: "morning-brief",
      layer: "yours",
      forkedFrom: { slug: "morning-brief", version: published.version },
    });
    const mine = await findForViewer(db, owner, "morning-brief");
    expect(mine?.layer).toBe("yours");
    expect((await findForViewer(db, stranger, "morning-brief"))?.layer).toBe("published");
    // The list shows the shadow once, as the owner's, not twice.
    const list = await listForViewer(db, owner);
    expect(list.filter((s) => s.slug === "morning-brief")).toHaveLength(1);
    expect(list.find((s) => s.slug === "morning-brief")?.layer).toBe("yours");
    // Forking again is refused: the shadow exists.
    expect(await forkSkill(db, owner, "morning-brief")).toEqual({ ok: false, reason: "exists" });
  });

  it("delete stamps the current row; the published skill shows through again", async () => {
    const gone = await deleteUserSkill(db, owner, "morning-brief");
    expect(gone).toEqual({ slug: "morning-brief", shadowed: true });
    expect((await findForViewer(db, owner, "morning-brief"))?.layer).toBe("published");
    expect(await deleteUserSkill(db, owner, "morning-brief")).toBeNull();
  });

  it("a deleted skill can be created again with identical content; the deleted row stays as history", async () => {
    // The live one from the earlier steps goes first; then the same content
    // is created again under the SAME slug, which the old (owner, slug,
    // version) unique index refused because the deleted row still matched.
    expect(await deleteUserSkill(db, owner, "sweep-my-drafts-folder")).toEqual({ slug: "sweep-my-drafts-folder", shadowed: false });
    const again = await createUserSkill(db, owner, VALID);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.skill.slug).toBe("sweep-my-drafts-folder");
    expect(await deleteUserSkill(db, owner, "sweep-my-drafts-folder")).toEqual({ slug: "sweep-my-drafts-folder", shadowed: false });
    const once = await createUserSkill(db, owner, VALID);
    expect(once.ok && once.skill.slug).toBe("sweep-my-drafts-folder");
    expect(await deleteUserSkill(db, owner, "sweep-my-drafts-folder")).toEqual({ slug: "sweep-my-drafts-folder", shadowed: false });
  });

  it("the cap is a constant naming the number, with no plan anywhere near it", async () => {
    expect(USER_SKILL_CAP).toBe(50);
    const capped = await insertTestUser(db);
    for (let i = 0; i < USER_SKILL_CAP; i++) {
      const r = await createUserSkill(db, capped, { ...VALID, title: `Skill number ${i}` });
      expect(r.ok).toBe(true);
    }
    const over = await createUserSkill(db, capped, { ...VALID, title: "One too many" });
    expect(over).toEqual({ ok: false, reason: "cap", cap: 50 });
  });

  it("INVARIANT: exactly one current row per (owner, slug) among non-deleted rows", async () => {
    const dupes = await db.execute<{ owner_id: string | null; slug: string; n: number }>(sql`
      SELECT owner_id, slug, count(*)::int AS n
      FROM skills
      WHERE superseded_at IS NULL AND deleted_at IS NULL
      GROUP BY owner_id, slug
      HAVING count(*) > 1
    `);
    expect([...dupes]).toEqual([]);
  });
});
