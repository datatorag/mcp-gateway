import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { GROUPS } from "./connector-comparison";
import { CELLS } from "./demo/demo-bento";
import { VERIFIED_ON } from "@/lib/connector-verification";
import { siteFaqPages } from "@/lib/site-faq";

/**
 * The comparison table makes claims about someone else's product, and three
 * other surfaces repeat them: the demo rows above it, the FAQ under it, the
 * home page's description, and several blog posts. Whether a cell is TRUE cannot be tested here; that takes a
 * person reading both tool lists on a stated date. What can be tested is that
 * the surfaces do not contradict each other, which is how the last wrong
 * claim was found: a demo row said the built-in connector could not send,
 * a few hundred pixels above a table row that said it could.
 */

const rows = GROUPS.flatMap((g) => g.rows.map((r) => ({ ...r, service: g.service })));
const row = (capability: string) => {
  const found = rows.find((r) => r.capability === capability);
  if (!found) throw new Error(`no row "${capability}"`);
  return found;
};

describe("the comparison table as checked on its date", () => {
  it("carries one date, and renders it", () => {
    expect(VERIFIED_ON).toBe("9 October 2026");
    const source = readFileSync(join(__dirname, "connector-comparison.tsx"), "utf8");
    expect(source).toContain("{VERIFIED_ON}");
    // The section dates are gone; a leftover would render a second date.
    expect(source).not.toContain("GMAIL_VERIFIED_ON");
    expect(source).not.toContain("CALENDAR_VERIFIED_ON");
  });

  it("has no duplicate row labels inside a group", () => {
    // Rows are keyed by their label when rendered.
    for (const group of GROUPS) {
      const labels = group.rows.map((r) => r.capability);
      expect(new Set(labels).size, group.service).toBe(labels.length);
    }
  });

  it.each([
    // The rows this check moved, each as [label, built-in, ours].
    ["Delete a draft", true, true],
    ["Delete or trash a doc", true, true],
    ["Copy a file", true, true],
    ["Create a folder", true, true],
    ["Jira, read, create, comment, transition", true, true],
    ["Confluence, read, create, edit pages", true, true],
    // The rows it added.
    ["Query a sheet with a filter", false, true],
    ["Format cells and tables", false, true],
    ["Trash a message or thread", true, false],
    ["Rename a file", true, true],
    ["Move a file to another folder", true, false],
    ["Share a file with someone", true, false],
    ["Jira, attach an email or one of its attachments to an issue", false, true],
  ] as const)("%s", (capability, builtIn, ours) => {
    expect(row(capability)).toMatchObject({ builtIn, ours });
  });

  it("still concedes what it conceded before", () => {
    for (const capability of [
      "Send it",
      "Reply in thread",
      "Forward",
      "RSVP to an invitation",
      "Suggest a meeting time",
      "List your other calendars",
      "Download file content",
      "File metadata",
      "Sharing permissions",
      "Recently-opened files",
    ]) {
      expect(row(capability).builtIn, capability).toBe(true);
    }
  });

  it("does not say a count the rows could outgrow", () => {
    // "Five things it does that we do not" was true, then false, then true
    // again for a different five. Name them instead.
    for (const group of GROUPS) {
      const note = [group.note ?? []].flat().join(" ");
      expect(note, group.service).not.toMatch(
        /\b(two|three|four|five|six|seven|eight|nine|ten|\d+) (things|rows|tools)\b/i
      );
    }
  });

  it("contains no em-dashes", () => {
    for (const group of GROUPS) {
      const text = [group.service, ...group.rows.map((r) => r.capability), ...[group.note ?? []].flat()].join(" ");
      expect(text).not.toContain(String.fromCharCode(0x2014));
    }
  });
});

describe("the surfaces that repeat the table agree with it", () => {
  it("the home page description does not say the Drive connector cannot change a file", () => {
    // It renames, moves and trashes files. What it cannot do is edit what is
    // inside one, and the description is the sentence search results quote.
    const page = readFileSync(join(__dirname, "../app/page.tsx"), "utf8");
    const description = page.match(/const HOME_DESCRIPTION =\s*\n?\s*"([^"]+)"/)?.[1];
    expect(description, "HOME_DESCRIPTION not found").toBeDefined();
    expect(row("Rename a file").builtIn).toBe(true);
    expect(description).not.toMatch(/can't change them|cannot change them|read-only/i);
    expect(description).toMatch(/can't edit what's in them/);
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

  it("a demo row that names a connector's limit has a row here that agrees", () => {
    // Each line that names a Claude connector, with the table row that makes
    // the same claim. A new line of this kind must be added here with its row.
    const naming = problemLines.filter((line) => /Claude's \w+ connector/.test(line));
    const agreeing: Record<string, string> = {
      "Claude's Drive connector can make you a deck, but it arrives empty. One slide, and the title is yours to type.":
        "Put content in it",
      "Claude's Atlassian connector cannot attach a file to a Jira issue.":
        "Jira, attach an email or one of its attachments to an issue",
    };
    for (const line of naming) {
      if (/signed in to one account/.test(line)) {
        expect(row("Work and personal account at the same time").builtIn).toBe(false);
        continue;
      }
      expect(agreeing[line], `no table row recorded for: ${line}`).toBeDefined();
      expect(row(agreeing[line]).builtIn, line).toBe(false);
    }
    // And the line about Sheets, which names Claude rather than a connector.
    expect(row("Update a cell").builtIn).toBe(false);
  });

  it("no FAQ answer on the site denies a row the table concedes", () => {
    // The home page FAQ once cited this table as agreeing that the built-in
    // Gmail connector cannot delete a draft, after the table stopped saying
    // so. Every answer is read, not only the one that lists the gaps.
    const all = siteFaqPages().flatMap((p) => p.faqs.map((f) => ({ route: p.slug, a: f.a })));
    expect(all.length).toBeGreaterThan(10);
    expect(row("Delete a draft").builtIn).toBe(true);
    expect(row("Create a folder").builtIn).toBe(true);
    for (const { route, a } of all) {
      expect(a, route).not.toMatch(/cannot delete a draft|can't delete a draft|no draft delete/i);
      expect(a, route).not.toMatch(/cannot (send|reply|forward)/i);
      expect(a, route).not.toMatch(/cannot create a folder/i);
    }
  });

  it("the FAQ's list of where the built-in connectors stop holds no item the table concedes", () => {
    const answers = siteFaqPages()
      .flatMap((p) => p.faqs)
      .map((f) => f.a)
      .filter((a) => a.includes("Where the built-in connectors stop"));
    expect(answers).toHaveLength(1);
    const [answer] = answers;
    expect(answer).toContain(VERIFIED_ON);
    // Creating and updating issues is something Claude's Atlassian connector
    // does, so it cannot be on a list of where the built-in connectors stop.
    expect(row("Jira, read, create, comment, transition").builtIn).toBe(true);
    expect(answer).not.toMatch(/files and updates Jira issues/);
    expect(answer).toMatch(/attaches an email or a file inside it to a Jira issue/);
  });
});
