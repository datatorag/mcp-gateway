import { afterEach, describe, expect, it, vi } from "vitest";
import { NotionClient } from "../notion-client.js";
import { fakeFetch } from "../fixtures/fake-fetch.js";
import {
  NOTES_NEW,
  NOTES_NEW_CHILDREN,
  NOTES_OLD,
  NOTES_OLD_CHILDREN,
  NOTE_OLD,
  QUERY_ANSWER,
  SUMMARY_NEW,
  SUMMARY_NEW_CHILDREN,
  SUMMARY_OLD,
  SUMMARY_OLD_CHILDREN,
  TRANSCRIPT_NEW,
  TRANSCRIPT_NEW_CHILDREN,
  SUMMARY_LIKE_REAL,
  USER,
  USERS_LIST,
  children,
} from "../fixtures/meeting-notes-documented.js";
import { MAX_USER_LOOKUPS, MEETING_NOTES_TOOL, MEETING_QUERY_REFUSED, NO_MEETING_NOTES_PLAN, dateValue, handleMeetingNotes, meetingQuery } from "./notion-meetings.js";

/* SCRUM-501: the meeting notes list, through the real client against a
 * stubbed fetch, on answers shaped from Notion's reference. */

const TOKEN = "fixture-bearer-not-a-real-token";
const client = () => new NotionClient({ accessToken: TOKEN }).forTool(true);
const ok = (body: unknown) => ({ status: 200, body });

afterEach(() => vi.unstubAllGlobals());

async function call(args: Record<string, unknown>) {
  const res = await handleMeetingNotes(client(), MEETING_NOTES_TOOL, args);
  return JSON.parse(res.content[0].text);
}

describe("the query Notion is sent", () => {
  it("defaults to notes since yesterday, the newest at the top, ten of them", () => {
    // A lone filter still goes inside a combinator: Notion refuses one at the top.
    expect(meetingQuery({})).toEqual({
      filter: {
        operator: "and",
        filters: [{ property: "created_time", filter: { operator: "date_is_on_or_after", value: { type: "relative", value: "yesterday" } } }],
      },
      sort: [{ property: "created_time", direction: "descending" }],
      limit: 10,
    });
  });

  it("joins a date range and a title with and", () => {
    const q = meetingQuery({ since: "2026-11-01", until: "2026-11-15", title: " planning ", limit: 99 });
    expect(q.limit).toBe(50);
    expect(q.filter).toEqual({
      operator: "and",
      filters: [
        { property: "created_time", filter: { operator: "date_is_on_or_after", value: { type: "exact", value: { type: "date", start_date: "2026-11-01" } } } },
        { property: "created_time", filter: { operator: "date_is_on_or_before", value: { type: "exact", value: { type: "date", start_date: "2026-11-15" } } } },
        { property: "title", filter: { operator: "string_contains", value: { type: "exact", value: "planning" } } },
      ],
    });
  });

  it("refuses a date it cannot send, in words", () => {
    expect(() => dateValue("last tuesday", "since")).toThrow(/since must be a date as YYYY-MM-DD/);
    expect(() => dateValue("2026-13-45", "until")).toThrow(/until must be/);
    expect(dateValue("one_week_ago", "since")).toEqual({ type: "relative", value: "one_week_ago" });
  });
});

describe("the answer", () => {
  it("carries the summary, notes, attendees, and action items, and never fetches the transcript unless asked", async () => {
    const f = fakeFetch([
      ok(QUERY_ANSWER),
      ok(SUMMARY_NEW_CHILDREN),
      ok(NOTES_NEW_CHILDREN),
      ok(SUMMARY_OLD_CHILDREN),
      ok(NOTES_OLD_CHILDREN),
    ]);
    const out = await call({});
    expect(f.sent[0]).toMatchObject({ method: "POST", url: new URL("https://api.notion.com/v1/blocks/meeting_notes/query") });
    expect(f.sent.some((r) => r.url.pathname.includes(TRANSCRIPT_NEW))).toBe(false);
    // One read of the workspace's user list names every attendee of every note.
    // Names are not asked for, so no user is read.
    expect(f.sent.some((r) => r.url.pathname.startsWith("/v1/users"))).toBe(false);

    const [first, second] = out.results;
    expect(first).toMatchObject({
      title: "Sprint planning",
      status: "notes_ready",
      meeting_start: "2026-11-19T10:00:00.000Z",
      meeting_end: "2026-11-19T10:30:00.000Z",
      attendee_count: 1,
      notes: "- Scope is fixed for this sprint",
      action_items: [
        { text: "Ada drafts the release notes", done: null },
        { text: "Ben books the demo", done: false },
      ],
    });
    expect(first.summary).toContain("The team agreed the release scope.");
    expect(first.summary).toContain("- [ ] Ben books the demo");
    expect(first).not.toHaveProperty("transcript");
    expect(first).not.toHaveProperty("attendees");
    expect(first).not.toHaveProperty("attendees_unnamed");
    expect(second.title).toBe("Weekly sync");
    expect(out).toMatchObject({ has_more: false, next_cursor: null });
    expect(out).not.toHaveProperty("left_out");
  });

  it("in a summary laid out as a real one, the action items are its to-dos and nothing under the other headings", async () => {
    fakeFetch([ok({ ...QUERY_ANSWER, results: [QUERY_ANSWER.results[0]] }), ok(SUMMARY_LIKE_REAL), ok(children())]);
    const out = await call({});
    expect(out.results[0].action_items).toEqual([
      { text: "Test User: get the test running", done: false },
      { text: "Test User: show the output", done: true },
    ]);
    expect(out.results[0].summary).toContain("## Open Questions");
    expect(out.results[0].notes).toBe("");
  });

  it("reads the transcript when asked", async () => {
    fakeFetch([
      ok({ ...QUERY_ANSWER, results: [QUERY_ANSWER.results[0]] }),
      ok(SUMMARY_NEW_CHILDREN),
      ok(NOTES_NEW_CHILDREN),
      ok(TRANSCRIPT_NEW_CHILDREN),
    ]);
    const out = await call({ include_transcript: true });
    expect(out.results[0].transcript).toBe("Ada: shall we start?");
  });

  it("over the budget, the older note keeps its title and times and is listed in left_out", async () => {
    const f = fakeFetch([
      ok(QUERY_ANSWER),
      ok(SUMMARY_NEW_CHILDREN),
      ok(NOTES_NEW_CHILDREN),
      ok(SUMMARY_OLD_CHILDREN),
      ok(NOTES_OLD_CHILDREN),
    ]);
    const out = await call({ max_body_chars: 1000 });
    expect(out.left_out).toEqual([NOTE_OLD]);
    expect(out.left_out_reason).toMatch(/did not fit in max_body_chars \(1,000\)/);
    expect(out.results[1]).toMatchObject({ title: "Weekly sync", summary: null, notes: null, action_items: [] });
    expect(out.results[0].summary).not.toBeNull();
    expect(f.pending()).toBe(0);
  });

  it("a note still being summarized comes back with its status", async () => {
    const pending = structuredClone(QUERY_ANSWER.results[0]);
    pending.meeting_notes.status = "summary_in_progress";
    fakeFetch([ok({ results: [pending], has_more: true }), ok(children()), ok(children())]);
    const out = await call({});
    expect(out.results[0]).toMatchObject({ status: "summary_in_progress", summary: "", action_items: [] });
    expect(out.has_more).toBe(true);
  });

  it("no notes at all says whose notes are listed", async () => {
    fakeFetch([ok({ results: [], has_more: false })]);
    const out = await call({ since: "today" });
    expect(out.results).toEqual([]);
    expect(out.note).toMatch(/attended/);
  });

  it("a workspace whose plan lacks AI meeting notes answers with a sentence about the plan", async () => {
    // Notion's words, observed on the test workspace on 2026-11-20.
    const message =
      "This endpoint requires a plan with AI meeting notes enabled. Please upgrade your plan to use this feature: https://www.notion.com/pricing";
    fakeFetch([{ status: 400, body: { object: "error", status: 400, code: "validation_error", message } }]);
    await expect(handleMeetingNotes(client(), MEETING_NOTES_TOOL, {})).rejects.toThrow(NO_MEETING_NOTES_PLAN);
  });

  it("a query Notion refuses for its shape says the fault is the query, not the workspace", async () => {
    const message = "body failed validation: body.filter.operator should be defined, instead was `undefined`.";
    fakeFetch([{ status: 400, body: { object: "error", status: 400, code: "validation_error", message } }]);
    const said = await handleMeetingNotes(client(), MEETING_NOTES_TOOL, {}).then(
      () => "",
      (e: Error) => e.message
    );
    expect(said).toContain(MEETING_QUERY_REFUSED);
    expect(said).toContain("body.filter.operator should be defined");
    expect(said).not.toContain(NO_MEETING_NOTES_PLAN);
  });
});

/** A stubbed fetch that answers by path, for requests sent concurrently.
 * Records every request and the most requests in flight at once. */
function routedFetch(route: (path: string) => { status: number; body: unknown }) {
  const sent: string[] = [];
  let inFlight = 0;
  let maxInFlight = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input));
      sent.push(url.pathname);
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      const { status, body } = route(url.pathname);
      return new Response(JSON.stringify(body), { status });
    })
  );
  return { sent, maxInFlight: () => maxInFlight };
}

const guest = (i: number) => `99999999-0000-4000-8000-${String(i).padStart(12, "0")}`;
const note = (attendees: string[], id = QUERY_ANSWER.results[0].id) => {
  const n = structuredClone(QUERY_ANSWER.results[0]);
  n.id = id;
  n.meeting_notes.calendar_event.attendees = attendees;
  return n;
};
const empty = { results: [], has_more: false, next_cursor: null };

describe("attendees", () => {
  it("those the user list does not hold are looked up one by one, concurrently, and named", async () => {
    const guests = Array.from({ length: 40 }, (_, i) => guest(i));
    const f = routedFetch((path) => {
      if (path === "/v1/blocks/meeting_notes/query") return { status: 200, body: { results: [note([USER.id, ...guests])], has_more: false } };
      if (path === "/v1/users") return { status: 200, body: USERS_LIST };
      if (path.startsWith("/v1/users/")) return { status: 200, body: { object: "user", id: path.slice(10), type: "person", name: `Member ${path.slice(-2)}` } };
      return { status: 200, body: empty };
    });
    const out = await call({ include_attendees: true });
    expect(out.results[0].attendees).toHaveLength(41);
    expect(out.results[0].attendees_unnamed).toBe(0);
    expect(f.sent.filter((p) => p === "/v1/users")).toHaveLength(1);
    expect(f.sent.filter((p) => p.startsWith("/v1/users/"))).toHaveLength(40);
    expect(f.maxInFlight()).toBeGreaterThan(1);
    expect(f.maxInFlight()).toBeLessThanOrEqual(5);
  });

  it("past the cap of lookups, and where Notion gives no name, an attendee is counted, never listed by id", async () => {
    const guests = Array.from({ length: MAX_USER_LOOKUPS + 20 }, (_, i) => guest(i));
    const f = routedFetch((path) => {
      if (path === "/v1/blocks/meeting_notes/query") return { status: 200, body: { results: [note(guests)], has_more: false } };
      if (path === "/v1/users") return { status: 200, body: USERS_LIST };
      // Every tenth lookup is someone Notion will not name.
      if (path.startsWith("/v1/users/")) {
        const n = Number(path.slice(-2));
        return n % 10 === 0 ? { status: 404, body: { object: "error", status: 404, code: "object_not_found", message: "no" } } : { status: 200, body: { object: "user", name: `Member ${n}` } };
      }
      return { status: 200, body: empty };
    });
    const out = await call({ include_attendees: true });
    expect(f.sent.filter((p) => p.startsWith("/v1/users/"))).toHaveLength(MAX_USER_LOOKUPS);
    const named = out.results[0].attendees.length;
    expect(named + out.results[0].attendees_unnamed).toBe(MAX_USER_LOOKUPS + 20);
    expect(out.results[0].attendees_unnamed).toBeGreaterThanOrEqual(20);
    expect(JSON.stringify(out.results[0].attendees)).not.toMatch(/[0-9a-f]{8}-/);
  });

  it("an attendee of two notes is looked up once", async () => {
    const shared = guest(7);
    const f = routedFetch((path) => {
      if (path === "/v1/blocks/meeting_notes/query") {
        return { status: 200, body: { results: [note([shared]), note([shared, USER.id], NOTE_OLD)], has_more: false } };
      }
      if (path === "/v1/users") return { status: 200, body: USERS_LIST };
      if (path.startsWith("/v1/users/")) return { status: 200, body: { object: "user", name: "Guest Seven" } };
      return { status: 200, body: empty };
    });
    const out = await call({ include_attendees: true });
    expect(f.sent.filter((p) => p.startsWith("/v1/users/"))).toHaveLength(1);
    expect(out.results[0].attendees).toEqual(["Guest Seven"]);
    expect(out.results[1].attendees).toEqual(["Guest Seven", "Ada Example"]);
  });

  it("by default a note carries its attendee count and no user is read, however many attend", async () => {
    const many = Array.from({ length: 90 }, (_, i) => guest(i));
    const f = routedFetch((path) =>
      path === "/v1/blocks/meeting_notes/query" ? { status: 200, body: { results: [note(many)], has_more: false } } : { status: 200, body: empty }
    );
    const out = await call({});
    expect(f.sent.some((p) => p.startsWith("/v1/users"))).toBe(false);
    expect(out.results[0].attendee_count).toBe(90);
    expect(out.results[0]).not.toHaveProperty("attendees");
  });

  it("a note with no attendees reads no user list, even when names are asked for", async () => {
    const f = routedFetch((path) =>
      path === "/v1/blocks/meeting_notes/query" ? { status: 200, body: { results: [note([])], has_more: false } } : { status: 200, body: empty }
    );
    const out = await call({ include_attendees: true });
    expect(f.sent.some((p) => p.startsWith("/v1/users"))).toBe(false);
    expect(out.results[0]).toMatchObject({ attendee_count: 0, attendees: [], attendees_unnamed: 0 });
  });

  it("a user list Notion will not give falls back to the lookups, and the note still comes back", async () => {
    routedFetch((path) => {
      if (path === "/v1/blocks/meeting_notes/query") return { status: 200, body: { results: [note([USER.id])], has_more: false } };
      if (path === "/v1/users") return { status: 403, body: { object: "error", status: 403, code: "restricted_resource", message: "no" } };
      if (path.startsWith("/v1/users/")) return { status: 200, body: USER };
      return { status: 200, body: empty };
    });
    const out = await call({ include_attendees: true });
    expect(out.results[0]).toMatchObject({ attendees: ["Ada Example"], attendees_unnamed: 0, title: "Sprint planning" });
  });
});

describe("a part the note does not have yet", () => {
  it("a meeting not yet transcribed has a null summary and an empty notes string, as documented", async () => {
    const fresh = structuredClone(QUERY_ANSWER.results[0]);
    fresh.meeting_notes.status = "transcription_not_started";
    fresh.meeting_notes.children = { notes_block_id: NOTES_NEW } as typeof fresh.meeting_notes.children;
    fakeFetch([ok({ results: [fresh], has_more: false }), ok(children())]);
    const out = await call({});
    expect(out.results[0]).toMatchObject({ status: "transcription_not_started", summary: null, notes: "", action_items: [] });
  });
});

// The ids are used only through the fixture's answers.
void [SUMMARY_NEW, NOTES_NEW, SUMMARY_OLD, NOTES_OLD];
