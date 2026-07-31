import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { marked } from "marked";

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

const SKILLS_DIR = path.join(process.cwd(), "content", "skills");

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

let skillsCache: Skill[] | null = null;
const skillsBySlug = new Map<string, Skill>();

export function getAllSkills(): Skill[] {
  if (skillsCache) return skillsCache;
  if (!fs.existsSync(SKILLS_DIR)) return [];

  skillsCache = fs
    .readdirSync(SKILLS_DIR)
    .filter((f) => f.endsWith(".md"))
    .map((f) => parseSkill(f.replace(/\.md$/, "")))
    .filter((s): s is Skill => s !== null)
    .sort((a, b) => a.order - b.order);

  for (const skill of skillsCache) skillsBySlug.set(skill.slug, skill);
  return skillsCache;
}

export function getSkillBySlug(slug: string): Skill | null {
  if (!skillsCache) getAllSkills();
  return skillsBySlug.get(slug) ?? null;
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

function parseSkill(slug: string): Skill | null {
  const filePath = path.join(SKILLS_DIR, `${slug}.md`);
  if (!fs.existsSync(filePath)) return null;

  const raw = fs.readFileSync(filePath, "utf-8");
  const { data, content } = matter(raw);

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
    title: data.title ?? slug,
    situation: data.situation ?? "",
    produces: data.produces ?? "",
    tools: Array.isArray(data.tools) ? data.tools.map(String) : [],
    accounts: data.accounts === "multiple" ? "multiple" : "single",
    order: typeof data.order === "number" ? data.order : 99,
    introHtml: marked.parse(intro) as string,
    skillSource,
    notesHtml: marked.parse(notes) as string,
  };
}
