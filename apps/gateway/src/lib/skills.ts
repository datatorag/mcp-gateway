import { createHash } from "node:crypto";
import { marked } from "marked";
import { defineCollection, field, type ParsedFile } from "./content-collection";
import { connectorsFor, servicesFor } from "./skill-links";

/**
 * The skill catalogue (SCRUM-226: rows, with the files as the authored
 * source for what we publish).
 *
 * Two layers, one type. A PUBLISHED skill is authored as `content/skills/*.md`,
 * reviewed like code, and seeded into the `skills` table at boot with its
 * content hash as the version. A user's skill is a private row beside it,
 * created through the dashboard or the MCP built-ins. Every read here takes
 * a viewer: `null` sees the published set, a user id sees the published set
 * plus their own rows, and their own row wins when it shares a slug (a fork
 * shadows what it was forked from, for its owner only).
 *
 * The reads are async because they are a query. The published set is also
 * held as an in-process snapshot, warmed by the seeder and refreshed at most
 * every minute, so the public skill pages (campaign landing pages) never
 * wait on a cold database and never fall over on a slow one: a failed
 * refresh serves the last good snapshot, and a process with no snapshot yet
 * serves the parsed files, which ship in the image.
 */

/** The fields that make a skill; the content hash is over exactly these. */
export interface SkillContent {
  /** Query-shaped, for the page title and metadata ("Triage your Gmail
   * inbox with Claude"). The in-body H1 stays the artifact's own name. */
  title: string;
  /** The reader's problem, in their words. Headlines the index card. */
  situation: string;
  /** What they get out of it, concretely. */
  produces: string;
  /** Bare tool names the skill calls. Pinned against the shipped registry:
   * by `skills.test.ts` for the files, by validation at save for a user's. */
  tools: string[];
  /** "multiple" when the skill is written to run across several connected
   * accounts, "single" when it works against one. */
  accounts: "single" | "multiple";
  order: number;
  /** Prose above the skill file, markdown. */
  intro: string;
  /** The SKILL.md itself, verbatim: the copy payload and the run payload. */
  skillSource: string;
  /** The "Notes from running this" prose below the skill file, markdown. */
  notes: string;
}

export interface Skill extends SkillContent {
  slug: string;
  /** Null for a published skill. */
  owner: string | null;
  /** Which layer this row is, said on every surface (per HQ decision). */
  layer: "published" | "yours";
  /** The content hash. */
  version: string;
  /** For a fork: the published slug and version it was taken from. */
  forkedFrom: { slug: string; version: string } | null;
  /** Rendered from `intro` at read; never stored. */
  introHtml: string;
  /** Rendered from `notes` at read; never stored. */
  notesHtml: string;
}

/** The content hash that names a version. Sixteen hex characters of a
 * SHA-256 over the content fields in a fixed order: equal content is one
 * version, any field change is a new one. */
export function skillVersion(c: Partial<SkillContent> & { source?: string }): string {
  const payload = JSON.stringify([
    c.title ?? "",
    c.situation ?? "",
    c.produces ?? "",
    c.tools ?? [],
    c.accounts ?? "single",
    c.order ?? 99,
    c.intro ?? "",
    c.skillSource ?? c.source ?? "",
    c.notes ?? "",
  ]);
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

/** Derived fields, computed at read and read-only. */
export function renderSkill(fields: Omit<Skill, "introHtml" | "notesHtml">): Skill {
  return {
    ...fields,
    introHtml: marked.parse(fields.intro) as string,
    notesHtml: marked.parse(fields.notes) as string,
  };
}

/* ---------------------------------------------------------------------- */
/* The files: the authored source for published skills                     */
/* ---------------------------------------------------------------------- */

/** Matches the first fenced block in the body and captures its inner text.
 * Skills author the artifact as a ```markdown fence. */
const SKILL_FENCE = /^```markdown\n([\s\S]*?)\n```$/m;

function parseSkill({ slug, data, content }: ParsedFile): Skill | null {
  const fence = SKILL_FENCE.exec(content);
  if (!fence) return null; // a skill without its artifact is not a skill
  const skillSource = fence[1];

  // Drop the body's leading H1: the page renders its own query-shaped
  // heading, and the artifact's own name is already visible in the copied
  // file's frontmatter. Keeping both stacks two headings that disagree.
  const intro = content.slice(0, fence.index).replace(/^\s*#\s+.*\n/, "");
  const notes = content.slice(fence.index + fence[0].length);

  const c: SkillContent = {
    title: field.string(data.title, slug),
    situation: field.string(data.situation),
    produces: field.string(data.produces),
    tools: field.stringArray(data.tools),
    accounts: data.accounts === "multiple" ? "multiple" : "single",
    order: field.number(data.order, 99),
    intro,
    skillSource,
    notes,
  };
  return renderSkill({
    ...c,
    slug,
    owner: null,
    layer: "published",
    version: skillVersion(c),
    forkedFrom: null,
  });
}

const collection = defineCollection<Skill>({
  dir: "skills",
  parse: parseSkill,
  sort: (a, b) => a.order - b.order,
});

/** The published skills as the files say them. The seeder's input, the
 * accuracy and boundary tests' subject, and the cold-start fallback. */
export function readSkillFiles(): Skill[] {
  return collection.getAll();
}

/* ---------------------------------------------------------------------- */
/* The table: one query per read, behind a reader set at boot              */
/* ---------------------------------------------------------------------- */

/** What the table answers. Set once at boot by the seeder's caller; a
 * process with no reader (tests, a build) reads the files. */
export interface SkillReader {
  listForViewer(viewer: string | null): Promise<Skill[]>;
  findForViewer(viewer: string | null, slug: string): Promise<Skill | null>;
}

let reader: SkillReader | null = null;
let snapshot: { skills: Skill[]; at: number } | null = null;
export const PUBLISHED_SNAPSHOT_TTL_MS = 60_000;

export function setSkillReader(next: SkillReader | null): void {
  reader = next;
}

/** The seeder warms this at boot so the first request never waits. */
export function setPublishedSnapshot(skills: Skill[], now: number = Date.now()): void {
  snapshot = { skills, at: now };
}

/** The published set, synchronously: the snapshot, else the files. For the
 * few callers that cannot await (attributing a login by its `next` path). */
export function publishedSkillsSync(): Skill[] {
  return snapshot?.skills ?? readSkillFiles();
}

async function publishedSkills(now: number = Date.now()): Promise<Skill[]> {
  if (reader && (!snapshot || now - snapshot.at > PUBLISHED_SNAPSHOT_TTL_MS)) {
    try {
      snapshot = { skills: await reader.listForViewer(null), at: now };
    } catch (err) {
      // Slightly stale beats down: keep serving what we have.
      console.warn("[skills] published refresh failed; serving the last snapshot", err);
      if (!snapshot) return readSkillFiles();
    }
  }
  return snapshot?.skills ?? readSkillFiles();
}

/** Every skill the viewer can see: the published set for `null`, the
 * published set plus their own rows for a user, their own winning a slug. */
export async function getAllSkills(viewer: string | null = null): Promise<Skill[]> {
  if (viewer === null || !reader) return publishedSkills();
  try {
    return await reader.listForViewer(viewer);
  } catch (err) {
    console.warn("[skills] viewer read failed; serving the published set", err);
    return publishedSkills();
  }
}

export async function getSkillBySlug(slug: string, viewer: string | null = null): Promise<Skill | null> {
  if (viewer === null || !reader) {
    return (await publishedSkills()).find((s) => s.slug === slug) ?? null;
  }
  try {
    return await reader.findForViewer(viewer, slug);
  } catch (err) {
    console.warn("[skills] viewer lookup failed; serving the published set", err);
    return (await publishedSkills()).find((s) => s.slug === slug) ?? null;
  }
}

/** Sibling skills, ranked by shared connector then by authored order.
 * Deliberately NOT `getRelatedPosts`: different collection, and relevance
 * here is "same surface area", not tag overlap over a dated feed. */
export async function getRelatedSkills(slug: string, limit = 2): Promise<Skill[]> {
  const all = await publishedSkills();
  const skill = all.find((s) => s.slug === slug);
  if (!skill) return [];
  const connectors = new Set(connectorsFor(skill.tools));

  return all
    .filter((s) => s.slug !== slug)
    .sort((a, b) => {
      const aShared = connectorsFor(a.tools).some((c) => connectors.has(c));
      const bShared = connectorsFor(b.tools).some((c) => connectors.has(c));
      if (aShared !== bShared) return aShared ? -1 : 1;
      return a.order - b.order;
    })
    .slice(0, limit);
}

/* ---------------------------------------------------------------------- */
/* Running a skill (SCRUM-223)                                             */
/* ---------------------------------------------------------------------- */

/** The link builders and the two pure tool-to-service helpers live in
 * `skill-links.ts`, which has no server-only imports, so client components
 * can use them; re-exported here so server callers have one import for
 * everything about skills. */
export { skillDeepLink, signInAndRunHref, connectorsFor, servicesFor, skillContinueMessage } from "./skill-links";

/** The slug a validated `next` path names, or null. Only a PUBLISHED slug
 * counts: an event must never claim a skill the catalogue does not have,
 * and at login there is no viewer yet. */
export function skillSlugFromPath(path: unknown): string | null {
  if (typeof path !== "string") return null;
  let url: URL;
  try {
    url = new URL(path, "http://placeholder.invalid");
  } catch {
    return null;
  }
  if (url.pathname !== "/dashboard/agent") return null;
  const slug = url.searchParams.get("skill");
  if (!slug) return null;
  return publishedSkillsSync().some((s) => s.slug === slug) ? slug : null;
}

/** What a model is handed to run a skill, in the user's voice, with the
 * VERBATIM skill file inside. One string for every surface (the dashboard
 * agent, the MCP prompt, the MCP tool), so what a model receives is
 * byte-identical whichever door it came through. The skill's own rails are
 * the limits: nothing gains write behaviour by moving surfaces, and per HQ
 * decision a skill run prompts for nothing mid-run. */
/** One connected account as a skill run sees it. `service` is the connector
 * id the skill's tools map to (`servicesFor`), so the list can be scoped to
 * what the skill needs. */
export type RunAccount = { service: string; email: string; isDefault: boolean };

/** The mail service sorts first: the recipient rule names "the default
 * account of the first service listed", and what a skill sends to the user
 * is mail, so the first service must be the one with a mailbox. Everything
 * else follows alphabetically. */
function serviceRank(service: string): number {
  return service === "google-workspace" ? 0 : 1;
}

/** The user's connected-account rows, as the run message wants them:
 * default first, then by address, so the same accounts always give the
 * same text (the chat route recomputes it and compares byte for byte). */
export function runAccountsFrom(
  rows: ReadonlyArray<{ connectorType: string; accountEmail: string; isDefault: boolean | null }>
): RunAccount[] {
  return rows
    .map((r) => ({ service: r.connectorType, email: r.accountEmail, isDefault: !!r.isDefault }))
    .sort(
      (a, b) =>
        serviceRank(a.service) - serviceRank(b.service) ||
        a.service.localeCompare(b.service) ||
        Number(b.isDefault) - Number(a.isDefault) ||
        a.email.localeCompare(b.email)
    );
}

/** The accounts block of a run message (SCRUM-240). A run is HANDED its
 * accounts so it never has to ask: which accounts a service has, which is
 * the default, and the rule in one sentence. Scoped to the services the
 * skill's tools need; a skill with no recognisable service gets them all. */
function runAccountsBlock(skill: Pick<Skill, "tools">, accounts: readonly RunAccount[]): string {
  const needed = new Set(servicesFor(skill));
  const relevant = needed.size ? accounts.filter((a) => needed.has(a.service)) : [...accounts];
  if (relevant.length === 0) {
    return (
      "No account is connected for this run. Stop and say that nothing is connected; " +
      "do not ask which account to use."
    );
  }
  const byService = new Map<string, RunAccount[]>();
  for (const a of relevant) byService.set(a.service, [...(byService.get(a.service) ?? []), a]);
  const lines = [...byService.entries()].map(
    ([service, list]) =>
      `- ${service}: ${list.map((a) => (a.isDefault ? `${a.email} (default)` : a.email)).join(", ")}`
  );
  return (
    "Accounts for this run, by service:\n" +
    lines.join("\n") +
    "\n\nCover every account listed for a service this skill needs. The recipient of anything " +
    "the skill sends to you is the default account of the first service listed. Use a subset " +
    "only where this message names one. Do not ask which accounts to cover or in what order; " +
    "this list is the answer."
  );
}

export function skillRunMessage(
  skill: Pick<Skill, "title" | "skillSource" | "tools">,
  accounts: readonly RunAccount[] = []
): string {
  return (
    `Run the following skill for me now: ${skill.title}. ` +
    "Follow it exactly as written, using my connected accounts, and stay within " +
    "its own rails. Report what you did at the end.\n\n" +
    runAccountsBlock(skill, accounts) +
    "\n\n" +
    skill.skillSource
  );
}

/** Which layer a skill is, in the words every surface uses (per HQ
 * decision: the card, the run preface, `skills_get` and `prompts/get`). */
export function layerLabel(skill: Pick<Skill, "layer">): "your version" | "published" {
  return skill.layer === "yours" ? "your version" : "published";
}
