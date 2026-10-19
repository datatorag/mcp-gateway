import { describe, expect, it } from "vitest";
import { allTools } from "./index.js";
import { handleCalendar } from "./calendar.js";
import { fakeClient } from "./fake-client.test-helper.js";

/* SCRUM-419. A tool description that DESCRIBES says what the tool does, what
 * it takes and what it returns. One that INSTRUCTS tells the reader's model
 * how to behave ("always", "never", "you must", "only use"), which is the
 * shape a directory reviewer reads as a tool steering its caller.
 *
 * The rule is held for the tools written under it, by name. The older
 * descriptions were written before it and are not claimed here; widening
 * this list is how one of them is brought under the rule. */
const DESCRIBED = [
  "gws_run",
  "sheets_get_metadata",
  "sheets_copy_tab_to",
  "gmail_trash",
  "gmail_untrash",
  "gmail_list_drafts",
  "gmail_get_attachment",
  "drive_get_file",
  "drive_move_file",
  "drive_trash_file",
  // SCRUM-428, the built-in connectors' surface.
  "calendar_respond_to_event",
  "calendar_list_calendars",
  "calendar_suggest_time",
  "gmail_trash_thread",
  "gmail_untrash_thread",
  "gmail_mark_spam",
  "gmail_unmark_spam",
  "drive_share_file",
  "drive_get_file_permissions",
  "drive_list_recent_files",
];

/** Words that address the reader's behaviour instead of the tool's. */
const INSTRUCTING_WORDS = /\b(always|never|must|should|do not|don't|only use|make sure|be sure|remember to|you|your|prefer|instead of|first)\b/i;
/** Emphasis by capitals, which is instruction by volume. */
const SHOUTING = /[A-Z]{4,} [A-Z]{4,}/;
const INSTRUCTING = { test: (text: string) => INSTRUCTING_WORDS.test(text) || SHOUTING.test(text) };
const instructing = (text: string) => text.match(INSTRUCTING_WORDS)?.[0] ?? text.match(SHOUTING)?.[0];

describe("descriptions describe and do not instruct (SCRUM-419)", () => {
  it("every tool under the rule is served", () => {
    const served = new Set(allTools.map((t) => t.name));
    expect(DESCRIBED.filter((n) => !served.has(n))).toEqual([]);
  });

  for (const name of DESCRIBED) {
    it(`${name}: no instructing words, in the description or any argument's`, () => {
      const tool = allTools.find((t) => t.name === name)!;
      const texts = [
        tool.description,
        ...Object.values(tool.inputSchema.properties).map((p) => String((p as { description?: string }).description ?? "")),
      ];
      for (const text of texts) {
        expect(instructing(text), text).toBeUndefined();
        expect(text).not.toContain("\u2014");
      }
    });
  }

  it("the pattern still finds what it is for, so it cannot pass by going blind", () => {
    for (const bad of [
      "FALLBACK ONLY, use dedicated tools first.",
      "Always call this before sending.",
      "You must pass a range.",
      "Never use this for drafts.",
      "Use this instead of several calls.",
      "TWO PROPERTIES THAT BITE.",
    ]) {
      expect(INSTRUCTING.test(bad), bad).toBe(true);
    }
    // And it leaves plain description alone.
    expect(INSTRUCTING.test("Moves one Gmail message to Trash. Takes the message ID. Returns the labels.")).toBe(false);
  });

  it("gws_run names the APIs it reaches and where they are documented", () => {
    const { description } = allTools.find((t) => t.name === "gws_run")!;
    for (const api of ["gmail", "calendar", "drive", "sheets", "docs", "slides", "people", "tasks"]) {
      expect(description).toContain(`(${api})`);
    }
    expect(description).toContain("https://developers.google.com/workspace");
  });
});

describe("gws_run names exactly the services it can reach", () => {
  it("the eight in the description are the eight in the method table", async () => {
    const { METHOD_TABLE } = await import("../google-api/method-table.js");
    const { description } = allTools.find((t) => t.name === "gws_run")!;
    const named = [...description.matchAll(/\(([a-z]+)\)/g)].map((m) => m[1]).sort();
    expect(named).toEqual(Object.keys(METHOD_TABLE).sort());
  });
});

describe("calendar_list_events takes back the page token it hands out (SCRUM-419)", () => {
  it("sends page_token as pageToken, and sends none when none is given", async () => {
    const paged = fakeClient([{ data: { items: [] } }]);
    await handleCalendar(paged.client, "calendar_list_events", { page_token: "tok-2" });
    expect((paged.calls[0].params as Record<string, unknown>).pageToken).toBe("tok-2");

    const first = fakeClient([{ data: { items: [], nextPageToken: "tok-2" } }]);
    const result = await handleCalendar(first.client, "calendar_list_events", {});
    expect(first.calls[0].params).not.toHaveProperty("pageToken");
    expect(JSON.parse(result.content[0].text).nextPageToken).toBe("tok-2");
  });

  it("declares the argument, so the validator lets it through", () => {
    const tool = allTools.find((t) => t.name === "calendar_list_events")!;
    expect(tool.inputSchema.properties).toHaveProperty("page_token");
  });
});
