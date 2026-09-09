import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Published skills are grown from routines we run ourselves, and those
 * routines are written for one person with named mailboxes and internal
 * bookkeeping. This repo is public, and a skill file is copied verbatim
 * into a stranger's agent, so the scrub between the two is a boundary the
 * suite holds rather than a step someone remembers.
 *
 * Two layers, deliberately split:
 *
 * - SHAPES, committed here: an address outside the documentation domains,
 *   an id of the kinds our internal records use, a long opaque identifier,
 *   a ticket id inside the copyable block. A shape names no value.
 * - VALUES, never committed: the specific strings that must not appear
 *   (addresses, names, namespaces, paths, tool and session names) are read
 *   from a private denylist named by SKILLS_DENYLIST, one entry per line,
 *   when that file is present. Listing them in this file would publish the
 *   very things the test exists to keep out, so without the file that layer
 *   is skipped visibly rather than silently passed.
 *
 * READ A GREEN RUN ACCORDINGLY. "The boundary test passed" is an incomplete
 * sentence: passed WITH the denylist and passed WITHOUT it are different
 * claims. A name is a value, not a shape, so the highest-consequence items
 * (a person, an employer) can only ever be caught by the private layer. A
 * run with 11 skips held the shapes and nothing else; a person with the
 * denylist is the boundary, and any automated run is a subset of it.
 */
const SKILLS_DIR = join(process.cwd(), "content", "skills");
const files = readdirSync(SKILLS_DIR).filter((f) => f.endsWith(".md"));

/** Every email-shaped token must be a documentation placeholder. The one
 * non-placeholder allowed is the Gmail permalink pattern, whose `authuser=`
 * value is a template, not an address. */
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
// RFC 2606 reserves example.com/.net/.org and the .example TLD for
// documentation; a skill may illustrate with those and nothing else.
const ALLOWED_EMAIL = /@([\w-]+\.)*(example\.(com|net|org)|[\w-]+\.example)$/;

/** Identifier SHAPES used by internal records, and a long opaque id of the
 * kind a spreadsheet or task list carries. Applied to the whole file. */
const SHAPE_PATTERNS: Array<{ name: string; re: RegExp }> = [
  { name: "internal record id", re: /\b[a-z]-\d{3}\b/ },
  { name: "long opaque id", re: /\b[A-Za-z0-9_-]{40,}\b/ },
];

/** The fenced block is the part a reader copies into their own agent, so it
 * is held to a stricter rule than the page prose around it: a ticket id is
 * fine in a note explaining why a rule exists (the repo's convention allows
 * ticket ids), and meaningless inside instructions that run against a
 * stranger's accounts. */
function copyableBlock(text: string): string {
  const match = text.match(/```markdown\n([\s\S]*?)\n```/);
  return match?.[1] ?? "";
}

function loadDenylist(): string[] | null {
  const path = process.env.SKILLS_DENYLIST;
  if (!path || !existsSync(path)) return null;
  return readFileSync(path, "utf8")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#"));
}

describe("published skills stay on the public side of the boundary", () => {
  it.each(files)("%s puts no ticket id inside the copyable skill file", (file) => {
    const block = copyableBlock(readFileSync(join(SKILLS_DIR, file), "utf8"));
    expect(block.length, `no copyable block found in ${file}`).toBeGreaterThan(0);
    expect(/\bSCRUM-\d+\b/.test(block), `ticket id inside ${file}'s skill file`).toBe(false);
  });

  it.each(files)("%s names no real address", (file) => {
    const text = readFileSync(join(SKILLS_DIR, file), "utf8");
    const addresses = (text.match(EMAIL_RE) ?? []).filter(
      (a) => !ALLOWED_EMAIL.test(a)
    );
    expect(addresses, `addresses in ${file}: ${addresses.join(", ")}`).toEqual([]);
  });

  it.each(files)("%s carries no internal identifier shape", (file) => {
    const text = readFileSync(join(SKILLS_DIR, file), "utf8");
    for (const { name, re } of SHAPE_PATTERNS) {
      expect(re.test(text), `${name} in ${file}`).toBe(false);
    }
  });

  /* SCRUM-224: what the MCP surface hands a client is the catalogue's run
   * message plus a connection preface. Pin that the preface adds nothing
   * beyond fixed sentences, service names and the addresses it was GIVEN, so
   * the file-level checks above cover what the wire carries. */
  it("the MCP apply text for every skill is the preface plus the verbatim run message", async () => {
    const { readSkillFiles, runAccountsFrom, skillRunMessage } = await import("./skills");
    const { skillApplyText } = await import("@/gateway/skills-catalogue");
    for (const skill of readSkillFiles()) {
      const text = skillApplyText(skill, {
        connected: new Set(["google-workspace", "atlassian"]),
        accounts: [
          { connectorType: "google-workspace", accountEmail: "me@example.com", isDefault: true },
          { connectorType: "atlassian", accountEmail: "me@example.org", isDefault: true },
        ],
        connectionsUrl: "https://example.com/dashboard/connections",
      });
      const run = skillRunMessage(
        skill,
        runAccountsFrom([
          { connectorType: "google-workspace", accountEmail: "me@example.com", isDefault: true },
          { connectorType: "atlassian", accountEmail: "me@example.org", isDefault: true },
        ])
      );
      expect(text.endsWith(run), skill.slug).toBe(true);
      const preface = text.slice(0, text.length - run.length);
      // The address regex is greedy on dots; a sentence-ending period after
      // an address is punctuation, not part of the host.
      const addresses = (preface.match(EMAIL_RE) ?? [])
        .map((a) => a.replace(/\.$/, ""))
        .filter((a) => !ALLOWED_EMAIL.test(a));
      expect(addresses, `preface addresses for ${skill.slug}`).toEqual([]);
      for (const { name, re } of SHAPE_PATTERNS) {
        expect(re.test(preface), `${name} in the preface for ${skill.slug}`).toBe(false);
      }
    }
  });

  const denylist = loadDenylist();
  const withValues = denylist ? it : it.skip;
  withValues.each(files)(
    "%s contains none of the private denylist entries (SKILLS_DENYLIST)",
    (file) => {
      const text = readFileSync(join(SKILLS_DIR, file), "utf8").toLowerCase();
      const hits = (denylist ?? []).filter((entry) => text.includes(entry.toLowerCase()));
      // The failure names how many entries matched, never which. Whoever
      // runs it with the file has the file.
      expect(hits.length, `${hits.length} denylist entr${hits.length === 1 ? "y" : "ies"} found in ${file}`).toBe(0);
    }
  );
});
