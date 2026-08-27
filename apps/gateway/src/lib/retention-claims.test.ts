import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

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

describe("retention claims are qualified", () => {
  it("scans a non-empty set of files", () => {
    // Guards the guard: an empty glob would make every assertion below pass.
    expect(filesToScan().length).toBeGreaterThan(10);
  });

  it("every unqualified retention claim links the privacy policy", () => {
    const offenders: string[] = [];

    for (const rel of filesToScan()) {
      let text: string;
      try {
        text = readFileSync(path.join(ROOT, rel), "utf8");
      } catch {
        continue;
      }
      const fileQualified = QUALIFIED.test(text);
      text.split("\n").forEach((line, i) => {
        // Frontmatter notes describe a PAST correction, so they legitimately
        // restate the old claim while explaining it.
        if (line.startsWith("updatedNote:")) return;
        if (!RETENTION_CLAIM.test(line)) return;
        if (!ABOUT_USER_DATA.test(line)) return;
        if (fileQualified) return;
        offenders.push(`${rel}:${i + 1}  ${line.trim().slice(0, 120)}`);
      });
    }

    expect(offenders, `Unqualified retention claims with no /privacy link:\n${offenders.join("\n")}`).toEqual([]);
  });
});
