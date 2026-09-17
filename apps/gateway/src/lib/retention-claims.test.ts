import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { SITE_FAQ_PAGES } from "./site-faq";

/**
 * A retention claim ("we don't store your data") is the line that decides the
 * sale for privacy-sensitive buyers, and an unqualified one is false for us:
 * the gateway keeps nothing, but the hosted agent on our own site stores its
 * conversation threads.
 *
 * WHY THIS IS KEYED TO THE CLAIM AND NOT TO A PHRASE — this is the whole point
 * of the file. Four posts were corrected in August 2026, and every correction
 * contained the literal string "no copy at all". The sweep looking for further
 * instances was keyed to THAT PHRASE. A fifth post asserting exactly the same
 * thing in different words ("doesn't store your data on the way") was therefore
 * structurally invisible to it: excluded by the instrument, not overlooked by
 * the operator. No amount of care would have found it, and each clean sweep
 * raised confidence that the set was closed.
 *
 * So the rule here is about the SHAPE of the assertion, and the requirement is
 * a linked qualification rather than particular wording. Rephrasing the claim
 * cannot evade it; only qualifying it can.
 */

const ROOT = process.cwd();
const CONTENT_DIRS = ["content/blog", "content/docs", "content/changelog"];
const COPY_FILES = ["src/app/page.tsx", "src/app/pricing/page.tsx"];

/** Assertions that we do not retain the user's content. Deliberately broad on
 * the verb and narrow on the object: "we don't store analytics" is a different
 * claim and not one this guard governs. */
const RETENTION_CLAIM =
  /\b(no copy|never (?:stores?|retains?|keeps?)|does ?n[o']t (?:store|retain|keep)|do ?n[o']t (?:store|retain|keep)|nothing is (?:stored|retained|kept)|keeps? nothing|without storing|never stored)\b/i;

/** The object the claim is about. A claim only matters here if it is about the
 * user's own material. */
const ABOUT_USER_DATA =
  /\b(your (?:data|files|documents|content|workspace|email|emails|mail|sheets|docs)|the data|your stuff|a copy)\b/i;

/** A qualification is a link to the policy that states what IS kept. */
const QUALIFIED = /\]\(\/privacy\)|href="\/privacy"|\/privacy\b/;

function filesToScan(): string[] {
  const out: string[] = [];
  for (const dir of CONTENT_DIRS) {
    const abs = path.join(ROOT, dir);
    let entries: string[] = [];
    try {
      entries = readdirSync(abs);
    } catch {
      continue; // directory may not exist in every checkout
    }
    for (const f of entries) {
      if (f.endsWith(".md") || f.endsWith(".mdx")) out.push(path.join(dir, f));
    }
  }
  for (const f of COPY_FILES) out.push(f);
  return out;
}

/** Per-post FAQ answers live in frontmatter as YAML folded block scalars, which
 * wrap one sentence across several physical lines. A per-line regex cannot see a
 * claim that straddles a line break, so "we do not / store your data" split over
 * two lines was invisible to this sweep: measured, not assumed, before this was
 * added. gray-matter has already folded each answer back into one string, so
 * scan that. Same failure the file header describes, arriving through a new
 * authoring shape rather than through new wording. */
function faqAnswerLines(text: string): string[] {
  let data: Record<string, unknown>;
  try {
    ({ data } = matter(text));
  } catch {
    return []; // malformed frontmatter is content-frontmatter.test.ts's job
  }
  if (!Array.isArray(data.faqs)) return [];
  return data.faqs.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const { a } = entry as { a?: unknown };
    return typeof a === "string" ? [a] : [];
  });
}

/** Every line this sweep judges: the file's own lines, plus each FAQ answer
 * folded back to one. */
function linesToScan(text: string): string[] {
  return [...text.split("\n"), ...faqAnswerLines(text)];
}

/** One body of copy and the lines it is judged by.
 *
 * WHY A UNIT AND NOT A FILE. Qualification is per file because a file was a
 * page: a post links the policy once and every claim in it is qualified. The
 * landing FAQs broke that equivalence, because one module now carries the
 * answers for several routes, and a `/privacy` link in a `/faq` answer would
 * silently qualify an unqualified claim on `/pricing`. So the landing module is
 * scanned one ROUTE at a time, and a route is qualified only by its own
 * answers. That is stricter than the file rule it replaces for that module, and
 * stricter is the right direction: a link in the page footer is not the
 * qualification a quoted answer carries with it. */
interface CopyUnit {
  label: string;
  lines: string[];
  qualified: boolean;
}

function landingUnits(): CopyUnit[] {
  return SITE_FAQ_PAGES.flatMap((page) => {
    const faqs = page.groups.flatMap((g) => g.faqs);
    // Qualification is computed once for the ROUTE and then carried by each of
    // its answers, so an offender names the question to open rather than an
    // offset into a module nobody reads by line number.
    const qualified = QUALIFIED.test(faqs.map((f) => f.a).join("\n"));
    return faqs.map((f) => ({
      label: `src/lib/site-faq.ts ${page.route} "${f.q}"`,
      lines: [f.a],
      qualified,
    }));
  });
}

function unitsToScan(): CopyUnit[] {
  const units: CopyUnit[] = [];
  for (const rel of filesToScan()) {
    let text: string;
    try {
      text = readFileSync(path.join(ROOT, rel), "utf8");
    } catch {
      continue;
    }
    units.push({ label: rel, lines: linesToScan(text), qualified: QUALIFIED.test(text) });
  }
  return [...units, ...landingUnits()];
}

describe("retention claims are qualified", () => {
  it("scans a non-empty set of files", () => {
    // Guards the guard: an empty glob would make every assertion below pass.
    expect(filesToScan().length).toBeGreaterThan(10);
  });

  it("scans the landing pages that hold their copy in a module", () => {
    // The same control, for the source that has no directory to glob. A renamed
    // export would empty this silently, and the file count above would not move.
    const units = landingUnits();
    expect(units.length).toBeGreaterThan(0);
    expect(units.every((u) => u.lines.length > 0)).toBe(true);
  });

  it("does not let one route's privacy link qualify another route's claim", () => {
    // The property the unit split exists for, pinned rather than left to the
    // shape of today's content: there is one landing route right now, so a
    // regression to file-level qualification would pass unnoticed until the
    // second route shipped a claim. Hand-built for the same reason.
    const qualifies = (answers: string[]) => QUALIFIED.test(answers.join("\n"));

    const withLink = ["Tokens are stored server side. See the [privacy policy](/privacy)."];
    const withClaim = ["We never store your data."];

    expect(qualifies(withLink)).toBe(true);
    expect(qualifies(withClaim)).toBe(false);
    expect(qualifies([...withLink, ...withClaim])).toBe(true); // same route: qualified
    expect(
      RETENTION_CLAIM.test(withClaim[0]) && ABOUT_USER_DATA.test(withClaim[0])
    ).toBe(true); // and it is a claim this sweep judges, not an inert string
  });

  it("every unqualified retention claim links the privacy policy", () => {
    const offenders: string[] = [];

    for (const unit of unitsToScan()) {
      unit.lines.forEach((line, i) => {
        // Frontmatter notes describe a PAST correction, so they legitimately
        // restate the old claim while explaining it.
        if (line.startsWith("updatedNote:")) return;
        if (!RETENTION_CLAIM.test(line)) return;
        if (!ABOUT_USER_DATA.test(line)) return;
        if (unit.qualified) return;
        offenders.push(`${unit.label}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    }

    expect(offenders, `Unqualified retention claims with no /privacy link:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("sees a retention claim that a folded FAQ answer wraps across lines", () => {
    // The reason faqAnswerLines exists, pinned so nobody deletes it as noise.
    // The claim below is split mid-sentence exactly as YAML wrapping produces.
    const wrapped = [
      "---",
      'title: "x"',
      "faqs:",
      "  - q: Where does my data go?",
      "    a: >-",
      "      Requests go straight to Google and back. We do not",
      "      store your data anywhere in the gateway.",
      "---",
      "body",
    ].join("\n");

    const hits = (lines: string[]) =>
      lines.filter((l) => RETENTION_CLAIM.test(l) && ABOUT_USER_DATA.test(l));

    // The gap: scanning the raw lines finds nothing, which is byte-identical to
    // a clean file. This assertion is the record of why the fold is needed.
    expect(hits(wrapped.split("\n"))).toEqual([]);
    // The fix: folded, the same claim is caught.
    expect(hits(linesToScan(wrapped))).toHaveLength(1);
  });

  it("still reads FAQ answers that are already clean", () => {
    // Positive control. Without it, faqAnswerLines returning [] for every file
    // would make the case above pass by looking at nothing, and the sweep would
    // report clean because it had gone blind rather than because content is ok.
    const real = readFileSync(
      path.join(ROOT, "content/blog/composio-vs-zapier-mcp.md"),
      "utf8"
    );
    const answers = faqAnswerLines(real);
    expect(answers.length).toBeGreaterThan(0);
    expect(answers.every((a) => !a.includes("\n"))).toBe(true);
  });
});
