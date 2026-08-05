import { marked } from "marked";
import { defineCollection, field, type ParsedFile } from "./content-collection";
import { getSkillBySlug, type Skill } from "./skills";

/** Who a set of skills is for.
 *
 * A layer above the skills, not a rewrite of them: each persona names skills
 * that already exist and can name the same skill as another persona. The
 * reader self-selects, which lets the site say who a workflow suits without
 * committing to a single audience.
 *
 * Every persona is grounded in a capability we actually have. That is the
 * whole constraint — an invented role reads as market research, and the one
 * thing worse than saying nothing about the audience is saying something
 * unsupportable about it on the highest-traffic page.
 *
 * Personas are their own route (`/skills/for/<slug>`) rather than anchors on
 * one page, so which audience actually reads is answerable from pageviews.
 */
export interface Persona {
  slug: string;
  /** Short, for the card heading and the page title. */
  title: string;
  /** The reader's own situation, in their words — same voice as a skill's
   * `situation`. Headlines the card. */
  situation: string;
  /** Query-shaped, for metadata. */
  metaTitle: string;
  order: number;
  /** Slugs of the skills that serve this persona, in the order they should
   * be read. Every one must resolve — `personas.test.ts` pins that, because
   * a dangling reference renders a page with a hole in it. */
  skillSlugs: string[];
  /** Prose above the skill list. */
  introHtml: string;
}

const collection = defineCollection<Persona>({
  dir: "personas",
  parse: parsePersona,
  sort: (a, b) => a.order - b.order,
});

export function getAllPersonas(): Persona[] {
  return collection.getAll();
}

export function getPersonaBySlug(slug: string): Persona | null {
  return collection.getBySlug(slug);
}

/** The persona's skills, resolved and in authored order. Silently drops a
 * slug that does not resolve so a typo degrades to a shorter list rather
 * than a crash; the test is what stops the typo shipping. */
export function skillsForPersona(persona: Persona): Skill[] {
  return persona.skillSlugs
    .map((slug) => getSkillBySlug(slug))
    .filter((skill): skill is Skill => skill !== null);
}

function parsePersona({ slug, data, content }: ParsedFile): Persona | null {
  const skillSlugs = field.stringArray(data.skills);
  // A persona with no skills is a claim about an audience with nothing to
  // back it, which is the exact failure this layer exists to avoid.
  if (skillSlugs.length === 0) return null;

  return {
    slug,
    title: field.string(data.title, slug),
    situation: field.string(data.situation),
    metaTitle: field.string(data.metaTitle, field.string(data.title, slug)),
    order: field.number(data.order, 99),
    skillSlugs,
    introHtml: marked.parse(content) as string,
  };
}
