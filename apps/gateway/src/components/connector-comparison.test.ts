import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GROUPS } from "./connector-comparison";
import { CELLS } from "./demo/demo-bento";
import { BUILT_IN_CHECKED_ON, BUILT_IN_HELP_URL } from "@/lib/connector-verification";
import { BUILT_IN_DIFFERENCE, siteFaqPages } from "@/lib/site-faq";

/**
 * The comparison table makes claims about someone else's product, and other
 * surfaces repeat them: the demo rows above it, the FAQ under it, the home
 * page's description, and several blog posts. Whether a cell is TRUE cannot
 * be tested here; that takes a person reading the vendor's help page on a
 * stated date. What can be tested is that the surfaces do not contradict each
 * other, that every dated statement reads the one date, and that the fixed
 * phrases the vendor's page does not support stay out.
 *
 * Since November 25, 2026 the built-in column is Anthropic's help page and
 * nothing else: `builtIn: true` means the page describes the row, `false`
 * means the page does not describe it, never that the connectors cannot.
 */

const rows = GROUPS.flatMap((g) => g.rows.map((r) => ({ ...r, service: g.service })));
const row = (capability: string) => {
  const found = rows.find((r) => r.capability === capability);
  if (!found) throw new Error(`no row "${capability}"`);
  return found;
};
const source = readFileSync(join(__dirname, "connector-comparison.tsx"), "utf8");
const notes = GROUPS.map((g) => ({ service: g.service, note: [g.note ?? []].flat().join(" ") }));

/** Phrases the site published about the built-in connectors that Anthropic's
 * help page does not say. Each is a fixed token, which is the kind of claim a
 * test can hold; a match is a candidate to read, not proof of a defect. */
const UNSUPPORTED = [
  /\bin beta\b/i,
  /arrives? empty|arrived empty(?! until)/i,
  /one (Google )?account at a time/i,
  /handle one Google account|signed in to one account/i,
  /no Contacts or Tasks connector|no built-in connector at all/i,
  /disconnect and reconnect/i,
];

describe("the comparison table as read on its date", () => {
  it("has one date and one vendor page, from one module, and renders both", () => {
    expect(BUILT_IN_CHECKED_ON).toBe("November 25, 2026");
    expect(BUILT_IN_HELP_URL.startsWith("https://support.claude.com/")).toBe(true);
    expect(source).toContain("{BUILT_IN_CHECKED_ON}");
    expect(source).toContain("href={BUILT_IN_HELP_URL}");
    // No date typed by hand where a reader sees it: the notes read the
    // constant. (Comments may name the day a rule changed.)
    for (const { service, note } of notes) {
      expect(note, service).toContain(BUILT_IN_CHECKED_ON);
    }
    // The enumeration dates are gone, from every surface that printed them.
    const verification = readFileSync(join(__dirname, "../lib/connector-verification.ts"), "utf8");
    expect(verification).not.toMatch(/export const (SLIDES_)?VERIFIED_ON/);
    for (const file of ["connector-comparison.tsx", "comparison-hero.tsx", "demo/demo-bento.tsx", "../app/page.tsx", "../lib/site-faq.ts"]) {
      expect(readFileSync(join(__dirname, file), "utf8"), file).not.toMatch(/\bVERIFIED_ON\b/);
    }
  });

  it("has no duplicate row labels inside a group", () => {
    // Rows are keyed by their label when rendered.
    for (const group of GROUPS) {
      const labels = group.rows.map((r) => r.capability);
      expect(new Set(labels).size, group.service).toBe(labels.length);
    }
  });

  it.each([
    // Each as [label, described on Anthropic's help page, ours], with the
    // page's own words in the comment beside the row in the component.
    ["Read a sheet", true, true],
    ["Create a new sheet", true, true],
    ["Edit an existing sheet", true, true],
    ["Query a sheet with a filter", false, true],
    ["Read a doc", true, true],
    ["Create a new doc", true, true],
    ["Edit an existing doc", true, true],
    ["Delete or trash a doc", true, true],
    ["Create a deck", true, true],
    ["Edit an existing deck", true, true],
    ["Read an existing deck", true, true],
    ["Send it", true, true],
    ["Reply in thread", true, true],
    ["Forward", true, true],
    ["List saved drafts", true, true],
    ["Organize mail with labels", true, true],
    ["Open an email attachment", true, true],
    ["Save an email or an attachment to Drive", false, true],
    ["Save an email or an attachment to your computer", false, true],
    ["Set up a recurring meeting", true, false],
    ["RSVP to an invitation", true, true],
    ["Find a time across attendees' availability", true, true],
    ["See your other calendars", true, true],
    ["File metadata", true, true],
    ["Sharing permissions", true, true],
    ["Recent files", true, true],
    ["Share a file with someone", true, true],
    ["Move a file to another folder", true, true],
    ["Trash a file", true, true],
    ["Upload a file", true, true],
    ["Create a folder", true, true],
    ["Google Contacts", false, true],
    ["Google Tasks", false, true],
    ["Several Google accounts behind one connection", false, true],
  ] as const)("%s", (capability, builtIn, ours) => {
    expect(row(capability)).toMatchObject({ builtIn, ours });
  });

  it("still concedes what it conceded before, where the vendor's page says so", () => {
    for (const capability of [
      "Send it",
      "Reply in thread",
      "Forward",
      "RSVP to an invitation",
      "File metadata",
      "Sharing permissions",
      "Edit an existing doc",
      "Create a folder",
    ]) {
      expect(row(capability).builtIn, capability).toBe(true);
    }
  });

  it("holds no row that showed a limit the vendor's page contradicts", () => {
    // "Put content in it" said a built-in deck arrived empty, and "Free/busy
    // lookup" said No beside a page that lists finding mutual availability.
    for (const gone of ["Put content in it", "Free/busy lookup"]) {
      expect(rows.map((r) => r.capability)).not.toContain(gone);
    }
  });

  it("never renders a built-in cell as No: the page being silent is not a limit", () => {
    // The built-in column goes through its own mark, which prints the words.
    expect(source).toContain("<BuiltInMark described={row.builtIn} />");
    expect(source).not.toContain("<Mark yes={row.builtIn} />");
    expect(source).toMatch(/NOT_DESCRIBED = "Not described"/);
    // And the table says what the words mean, next to the date.
    expect(source).toContain("which is not the same as Claude being unable to do");
  });

  it("says nothing about the built-in connectors that the vendor's page does not say", () => {
    for (const { service, note } of notes) {
      for (const phrase of UNSUPPORTED) expect(note, `${service}: ${phrase}`).not.toMatch(phrase);
    }
    // The rule can go red.
    expect(UNSUPPORTED.some((p) => p.test("Docs and Sheets have their own connectors, in beta on claude.ai"))).toBe(true);
    expect(UNSUPPORTED.some((p) => p.test("It also works one Google account at a time"))).toBe(true);
  });

  it("does not say a count the rows could outgrow", () => {
    // "Five things it does that we do not" was true, then false, then true
    // again for a different five. Name them instead.
    for (const { service, note } of notes) {
      expect(note, service).not.toMatch(
        /\b(two|three|four|five|six|seven|eight|nine|ten|\d+) (things|rows|tools)\b/i
      );
    }
  });

  it("contains no em or en dashes", () => {
    for (const group of GROUPS) {
      const text = [group.service, ...group.rows.map((r) => r.capability), ...[group.note ?? []].flat()].join(" ");
      expect(text).not.toMatch(/[\u2013\u2014]/);
    }
  });
});

describe("the surfaces that repeat the table agree with it", () => {
  it("the home page description makes no claim about what the built-in connector cannot do", () => {
    // It renames, moves and trashes files. Until 15 October 2026 this said
    // it cannot edit what is inside one. Anthropic announced Docs, Sheets and
    // Slides editing connectors on 6 October 2026 that we could not yet test,
    // so the sentence search results quote now says what we do and nothing
    // about what they cannot. The table, which carries the dated note, is
    // where that comparison lives.
    const page = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");
    const description = page.match(/const HOME_DESCRIPTION =\s*\n?\s*"([^"]+)"/)?.[1];
    expect(description, "HOME_DESCRIPTION not found").toBeDefined();
    expect(description).not.toMatch(/can't|cannot|can not|read-only|unable/i);
    // Since the built-in Docs and Sheets connectors edit in place too, the
    // sentence says what is ours (every account, any client, approval on each
    // write) and names no built-in connector at all.
    expect(description).not.toMatch(/Claude's/);
    expect(description).toMatch(/every account you connect/);
    expect(description).toMatch(/Every write asks you first/);
    // Search results cut around here.
    expect(description!.length).toBeLessThanOrEqual(160);
  });

  const problemLines = CELLS.map((cell) => cell.problem);

  it("finds the demo rows it is about to judge", () => {
    expect(problemLines).toHaveLength(5);
  });

  it("no demo row says the built-in connector cannot send, reply or forward", () => {
    // The table concedes all three. A row that denies one is disprovable from
    // the page it sits on.
    expect(row("Send it").builtIn).toBe(true);
    for (const line of problemLines) {
      expect(line).not.toMatch(/stops at the draft/i);
      expect(line).not.toMatch(/(cannot|can't|does not|doesn't|won't) (send|reply|forward)/i);
    }
  });

  it("no demo row names a limit in Claude's connectors", () => {
    // Three rows did until November 25, 2026 (an empty Slides deck, no file
    // on a Jira issue, one Gmail account), each from our own enumeration.
    // The vendor's page contradicted the first and is silent on the others.
    // A line that names a Claude connector again needs that vendor's page
    // and its date in the line, and a row in the table that agrees: add it
    // to `agreeing` with that row.
    const naming = problemLines.filter((line) => /Claude's \w+ connector/.test(line));
    const agreeing: Record<string, string> = {};
    for (const line of naming) {
      expect(agreeing[line], `no table row recorded for: ${line}`).toBeDefined();
      expect(line, line).toMatch(/\b20\d{2}\b/);
    }
    for (const line of problemLines) {
      for (const phrase of UNSUPPORTED) expect(line, `${phrase}`).not.toMatch(phrase);
      expect(line).not.toMatch(/cannot attach a file/i);
    }
    expect(problemLines.some((line) => /^Claude reads the sheet/.test(line))).toBe(false);
  });

  it("no FAQ answer on the site denies a row the table concedes", () => {
    // The home page FAQ once cited this table as agreeing that the built-in
    // Gmail connector cannot delete a draft, after the table stopped saying
    // so. Every answer is read, not only the one that lists the gaps.
    const all = siteFaqPages().flatMap((p) => p.faqs.map((f) => ({ route: p.slug, a: f.a })));
    expect(all.length).toBeGreaterThan(10);
    expect(row("Create a folder").builtIn).toBe(true);
    expect(row("Edit an existing doc").builtIn).toBe(true);
    expect(row("Edit an existing sheet").builtIn).toBe(true);
    expect(row("Edit an existing deck").builtIn).toBe(true);
    for (const { route, a } of all) {
      expect(a, route).not.toMatch(/cannot delete a draft|can't delete a draft|no draft delete/i);
      expect(a, route).not.toMatch(/cannot (send|reply|forward)/i);
      expect(a, route).not.toMatch(/cannot create a folder/i);
      expect(a, route).not.toMatch(/cannot (change|edit) (what is inside|a file you already have|an existing)|no cell-level editing|cannot edit (a|the) (doc|sheet|spreadsheet)/i);
      // What the vendor's page does not say, no answer says either.
      for (const phrase of UNSUPPORTED) expect(a, `${route}: ${phrase}`).not.toMatch(phrase);
      expect(a, route).not.toMatch(/nothing (built in|native)|Where they stop/i);
    }
  });

  it("every FAQ answer about the built-in connectors uses the shared, dated sentence", () => {
    // One wording for the vendor half, so a re-read of the page is one edit.
    const about = siteFaqPages()
      .flatMap((p) => p.faqs.map((f) => ({ route: p.slug, ...f })))
      .filter((f) => /(native|built-in) (Google )?connectors?|Claude's own/i.test(f.a));
    expect(about.length).toBeGreaterThanOrEqual(5);
    for (const f of about) {
      const where = `${f.route}: ${f.q}`;
      expect(f.a, where).toContain(BUILT_IN_DIFFERENCE.theirsLead);
      expect(f.a, where).toContain(`](${BUILT_IN_HELP_URL})`);
      expect(f.a, where).toContain(BUILT_IN_DIFFERENCE.theirsRest);
      // Ours first: the dated sentence about them never opens the answer.
      expect(f.a.indexOf("DataToRAG"), where).toBeLessThan(f.a.indexOf(BUILT_IN_DIFFERENCE.theirsLead));
    }
  });
});
