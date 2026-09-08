import { marked } from "marked";
import { defineCollection, field, type ParsedFile } from "./content-collection";

/** Skills are their own collection, not blog posts.
 *
 * A skill page is a reference artifact people return to and copy from; a blog
 * post is a one-time read. They share the markdown PIPELINE (gray-matter +
 * marked + the deploy-time cache) and nothing else — no shared list, no
 * reverse-chronological feed, no `getRelatedPosts`.
 *
 * The one mechanism worth understanding: `skillSource` is the fenced block
 * lifted VERBATIM out of the raw file, and it is what the copy button puts on
 * the clipboard. Rendering is display; the copy payload is never re-extracted
 * from rendered HTML, so what a user pastes into Claude is byte-for-byte the
 * file we tested.
 */

export interface Skill {
  slug: string;
  /** Query-shaped, for the page title and metadata ("Triage your Gmail
   * inbox with Claude"). The in-body H1 stays the artifact's own name. */
  title: string;
  /** The reader's problem, in their words. Headlines the index card. */
  situation: string;
  /** What they get out of it, concretely. */
  produces: string;
  /** Bare tool names the skill calls. Pinned against the shipped registry by
   * `skills.test.ts` — a skill naming a tool we do not ship fails the build. */
  tools: string[];
  /** "multiple" when the skill is written to run across several connected
   * accounts, "single" when it works against one. */
  accounts: "single" | "multiple";
  order: number;
  /** Prose above the skill file. */
  introHtml: string;
  /** The SKILL.md itself, verbatim — the copy payload. */
  skillSource: string;
  /** The "Notes from running this" prose below the skill file. */
  notesHtml: string;
}

/** Matches the first fenced block in the body and captures its inner text.
 * Skills author the artifact as a ```markdown fence. */
const SKILL_FENCE = /^```markdown\n([\s\S]*?)\n```$/m;

const collection = defineCollection<Skill>({
  dir: "skills",
  parse: parseSkill,
  sort: (a, b) => a.order - b.order,
});

export function getAllSkills(): Skill[] {
  return collection.getAll();
}

export function getSkillBySlug(slug: string): Skill | null {
  return collection.getBySlug(slug);
}

/** Sibling skills, ranked by shared connector then by authored order.
 * Deliberately NOT `getRelatedPosts`: different collection, and relevance
 * here is "same surface area", not tag overlap over a dated feed. */
export function getRelatedSkills(slug: string, limit = 2): Skill[] {
  const skill = getSkillBySlug(slug);
  if (!skill) return [];
  const connectors = new Set(connectorsFor(skill.tools));

  return getAllSkills()
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

/** Connector display name to the service id the connect flow and the
 * connections table use. One mapping, next to `connectorsFor`, so the three
 * surfaces that ask "does this user have what this skill needs" agree. */
const SERVICE_ID_BY_CONNECTOR: Record<string, string> = {
  "Google Workspace": "google-workspace",
  Atlassian: "atlassian",
};

/** The service ids a skill needs connected, in `connectorsFor` order. */
export function servicesFor(skill: Pick<Skill, "tools">): string[] {
  return connectorsFor(skill.tools)
    .map((name) => SERVICE_ID_BY_CONNECTOR[name])
    .filter((id): id is string => typeof id === "string");
}

/** The link builders live in `skill-links.ts`, which has no server-only
 * imports, so client components can use them; re-exported here so server
 * callers have one import for everything about skills. */
export { skillDeepLink, signInAndRunHref } from "./skill-links";

/** The slug a validated `next` path names, or null. Only a PUBLISHED slug
 * counts: an event must never claim a skill the catalogue does not have. */
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
  return getSkillBySlug(slug) ? slug : null;
}

/** What a model is handed to run a skill, in the user's voice, with the
 * VERBATIM skill file inside. One string for every surface (the dashboard
 * agent, the MCP prompt, the MCP tool), so what a model receives is
 * byte-identical whichever door it came through. The skill's own rails are
 * the limits: nothing gains write behaviour by moving surfaces, and per HQ
 * decision a skill run prompts for nothing mid-run. */
export function skillRunMessage(skill: Pick<Skill, "title" | "skillSource">): string {
  return (
    `Run the following skill for me now: ${skill.title}. ` +
    "Follow it exactly as written, using my connected accounts, and stay within " +
    "its own rails. Report what you did at the end.\n\n" +
    skill.skillSource
  );
}

/** Which connectors a tool set touches, from the tool-name prefix the
 * plugins already namespace by. */
export function connectorsFor(tools: string[]): string[] {
  const out = new Set<string>();
  for (const tool of tools) {
    if (/^(gmail|calendar|drive|sheets|docs|slides|contacts|tasks|gws)_/.test(tool)) {
      out.add("Google Workspace");
    } else if (/^(jira|confluence)_/.test(tool)) {
      out.add("Atlassian");
    }
  }
  return [...out];
}

function parseSkill({ slug, data, content }: ParsedFile): Skill | null {
  const fence = SKILL_FENCE.exec(content);
  if (!fence) return null; // a skill without its artifact is not a skill
  const skillSource = fence[1];

  // Drop the body's leading H1: the page renders its own query-shaped
  // heading, and the artifact's own name is already visible in the copied
  // file's frontmatter. Keeping both stacks two headings that disagree.
  const intro = content.slice(0, fence.index).replace(/^\s*#\s+.*\n/, "");
  const notes = content.slice(fence.index + fence[0].length);

  return {
    slug,
    title: field.string(data.title, slug),
    situation: field.string(data.situation),
    produces: field.string(data.produces),
    tools: field.stringArray(data.tools),
    accounts: data.accounts === "multiple" ? "multiple" : "single",
    order: field.number(data.order, 99),
    introHtml: marked.parse(intro) as string,
    skillSource,
    notesHtml: marked.parse(notes) as string,
  };
}
