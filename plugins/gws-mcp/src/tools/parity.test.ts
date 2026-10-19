import { describe, expect, it } from "vitest";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import { allTools } from "./index.js";
import { handleGmailMailbox } from "./gmail-mailbox.js";
import { handleGmail } from "./gmail.js";
import { handleCalendar } from "./calendar.js";
import { handleDrive } from "./drive.js";
import { freeSlots, mergeBusy, tzOffsetMinutes, zonedToUtc } from "./calendar-slots.js";

/* SCRUM-428: what Claude's built-in Google connectors do that we did not.
 * Each test is about the request a tool sends, what it refuses before
 * sending anything, and the shape it answers with. */

const tool = (name: string) => allTools.find((t) => t.name === name)!;

describe("annotations of the new tools", () => {
  it.each([
    ["gmail_trash_thread", false],
    ["gmail_untrash_thread", false],
    ["gmail_mark_spam", false],
    ["gmail_unmark_spam", false],
    ["calendar_respond_to_event", false],
    ["drive_share_file", false],
    ["calendar_list_calendars", true],
    ["calendar_suggest_time", true],
    ["drive_get_file_permissions", true],
    ["drive_list_recent_files", true],
  ] as const)("%s readOnlyHint is %s", (name, readOnly) => {
    expect(tool(name).annotations.readOnlyHint).toBe(readOnly);
  });

  it("the ones with an effect outside the account are destructive", () => {
    // Sharing and answering an invitation each tell another person something.
    expect(tool("drive_share_file").annotations.destructiveHint).toBe(true);
    expect(tool("calendar_respond_to_event").annotations.destructiveHint).toBe(true);
  });
});

describe("gmail spam", () => {
  it("mark_spam adds SPAM and takes the message out of the inbox, as Report spam does", async () => {
    const { client, calls } = fakeClient([{ data: { id: "m1", threadId: "t1", labelIds: ["SPAM"] } }]);
    const r = payload(await handleGmailMailbox(client, "gmail_mark_spam", { message_id: "m1" }));
    expect(calls).toEqual([
      {
        service: "gmail",
        resource: "users.messages",
        method: "modify",
        params: { userId: "me", id: "m1" },
        jsonBody: { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
      },
    ]);
    expect(r).toEqual({ message_id: "m1", thread_id: "t1", in_spam: true, labelIds: ["SPAM"] });
  });

  it("unmark_spam does the reverse, and in_spam comes from Gmail's answer", async () => {
    const { client, calls } = fakeClient([{ data: { id: "m1", labelIds: ["INBOX"] } }]);
    const r = payload(await handleGmailMailbox(client, "gmail_unmark_spam", { message_id: "m1" }));
    expect(calls[0].jsonBody).toEqual({ addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] });
    expect(r.in_spam).toBe(false);
  });

  it("refuses an id that is not an id, before any request", async () => {
    for (const bad of [undefined, "", "a/b", "id with space"]) {
      const { client, calls } = fakeClient([]);
      await expect(handleGmailMailbox(client, "gmail_mark_spam", { message_id: bad })).rejects.toThrow(/message_id/);
      expect(calls).toHaveLength(0);
    }
  });
});

describe("gmail thread trash and untrash", () => {
  it("trash_thread calls users.threads.trash and reports each message", async () => {
    const { client, calls } = fakeClient([
      { data: { id: "t1", messages: [{ id: "a", labelIds: ["TRASH"] }, { id: "b", labelIds: ["TRASH", "UNREAD"] }] } },
    ]);
    const r = payload(await handleGmailMailbox(client, "gmail_trash_thread", { thread_id: "t1" }));
    expect(calls).toEqual([{ service: "gmail", resource: "users.threads", method: "trash", params: { userId: "me", id: "t1" } }]);
    expect(r).toEqual({
      thread_id: "t1",
      message_count: 2,
      messages: [
        { message_id: "a", in_trash: true },
        { message_id: "b", in_trash: true },
      ],
    });
  });

  it("untrash_thread calls users.threads.untrash", async () => {
    const { client, calls } = fakeClient([{ data: { id: "t1", messages: [{ id: "a", labelIds: ["INBOX"] }] } }]);
    const r = payload(await handleGmailMailbox(client, "gmail_untrash_thread", { thread_id: "t1" }));
    expect(calls[0]).toMatchObject({ resource: "users.threads", method: "untrash" });
    expect(r.messages).toEqual([{ message_id: "a", in_trash: false }]);
  });

  it("refuses a thread id that is not an id", async () => {
    const { client, calls } = fakeClient([]);
    await expect(handleGmailMailbox(client, "gmail_trash_thread", { thread_id: "t/1" })).rejects.toThrow(/thread_id/);
    expect(calls).toHaveLength(0);
  });
});

describe("gmail_label_message with thread_id", () => {
  it("labels every message of the thread through users.threads.modify", async () => {
    const { client, calls } = fakeClient([{ data: { id: "t1", messages: [{ id: "a", labelIds: ["Label_1"] }] } }]);
    const r = payload(
      await handleGmail(client, "gmail_label_message", { thread_id: "t1", add_labels: ["Label_1"], remove_labels: ["UNREAD"] })
    );
    expect(calls).toEqual([
      {
        service: "gmail",
        resource: "users.threads",
        method: "modify",
        params: { userId: "me", id: "t1" },
        jsonBody: { addLabelIds: ["Label_1"], removeLabelIds: ["UNREAD"] },
      },
    ]);
    expect(r).toEqual({ thread_id: "t1", message_count: 1, messages: [{ id: "a", labelIds: ["Label_1"] }] });
  });

  it("refuses thread_id together with a message id, and a malformed thread id", async () => {
    const both = fakeClient([]);
    await expect(
      handleGmail(both.client, "gmail_label_message", { thread_id: "t1", message_id: "m1", add_labels: ["X"] })
    ).rejects.toThrow(/not both/);
    expect(both.calls).toHaveLength(0);
    const bad = fakeClient([]);
    await expect(handleGmail(bad.client, "gmail_label_message", { thread_id: "t 1", add_labels: ["X"] })).rejects.toThrow(/thread_id/);
    expect(bad.calls).toHaveLength(0);
  });

  it("without thread_id it labels messages as before", async () => {
    const { client, calls } = fakeClient([{ data: { id: "m1", labelIds: ["X"] } }]);
    await handleGmail(client, "gmail_label_message", { message_id: "m1", add_labels: ["X"] });
    expect(calls[0]).toMatchObject({ resource: "users.messages" });
  });
});

describe("calendar_respond_to_event", () => {
  const event = {
    id: "e1",
    summary: "Planning",
    attendees: [
      { email: "organizer@example.com", organizer: true, responseStatus: "accepted" },
      { email: "me@example.com", self: true, responseStatus: "needsAction" },
    ],
  };

  it("reads the event, then patches the guest list back with only this account's answer changed", async () => {
    const answered = { ...event, attendees: [event.attendees[0], { ...event.attendees[1], responseStatus: "tentative", comment: "Maybe" }] };
    const { client, calls } = fakeClient([{ data: event }, { data: answered }]);
    const r = payload(
      await handleCalendar(client, "calendar_respond_to_event", { event_id: "e1", response: "tentative", comment: "Maybe" })
    );
    expect(calls[0]).toMatchObject({ resource: "events", method: "get", params: { calendarId: "primary", eventId: "e1" } });
    expect(calls[1]).toMatchObject({
      resource: "events",
      method: "patch",
      params: { calendarId: "primary", eventId: "e1", sendUpdates: "all" },
      jsonBody: { attendees: [event.attendees[0], { ...event.attendees[1], responseStatus: "tentative", comment: "Maybe" }] },
    });
    expect(r).toEqual({ event_id: "e1", summary: "Planning", response: "tentative", comment: "Maybe" });
  });

  it("passes send_updates through", async () => {
    const { client, calls } = fakeClient([{ data: event }, { data: event }]);
    await handleCalendar(client, "calendar_respond_to_event", { event_id: "e1", response: "declined", send_updates: "none" });
    expect(calls[1].params).toMatchObject({ sendUpdates: "none" });
  });

  it("refuses an event the account is not invited to, and changes nothing", async () => {
    const { client, calls } = fakeClient([{ data: { id: "e1", attendees: [event.attendees[0]] } }]);
    await expect(handleCalendar(client, "calendar_respond_to_event", { event_id: "e1", response: "accepted" })).rejects.toThrow(
      /not on this event's guest list/
    );
    expect(calls).toHaveLength(1);
  });

  it("refuses a response that is not one of the three, before any request", async () => {
    const { client, calls } = fakeClient([]);
    await expect(handleCalendar(client, "calendar_respond_to_event", { event_id: "e1", response: "yes" })).rejects.toThrow(/response/);
    expect(calls).toHaveLength(0);
  });
});

describe("calendar_list_calendars", () => {
  it("asks for five fields only and answers compactly", async () => {
    const { client, calls } = fakeClient([
      {
        data: {
          items: [{ id: "primary@example.com", summary: "Me", primary: true, accessRole: "owner", timeZone: "Europe/London" }],
          nextPageToken: "n",
        },
      },
    ]);
    const r = payload(await handleCalendar(client, "calendar_list_calendars", { max_results: 999 }));
    expect(calls[0]).toMatchObject({
      resource: "calendarList",
      method: "list",
      params: { maxResults: 250, fields: "items(id,summary,primary,accessRole,timeZone),nextPageToken" },
    });
    expect(r).toEqual({
      count: 1,
      calendars: [{ id: "primary@example.com", summary: "Me", primary: true, access_role: "owner", time_zone: "Europe/London" }],
      nextPageToken: "n",
    });
  });
});

describe("calendar_suggest_time", () => {
  // Monday 19 October 2026, in London (UTC+1 until 25 October).
  const base = { attendees: "a@example.com", duration_minutes: 60, time_min: "2026-10-19T00:00:00Z", time_max: "2026-10-20T00:00:00Z", time_zone: "Europe/London" };

  it("asks free/busy for the account and every attendee, and suggests only clear slots inside working hours", async () => {
    const { client, calls } = fakeClient([
      {
        data: {
          calendars: {
            primary: { busy: [{ start: "2026-10-19T08:00:00Z", end: "2026-10-19T10:00:00Z" }] },
            "a@example.com": { busy: [{ start: "2026-10-19T11:30:00Z", end: "2026-10-19T12:00:00Z" }] },
          },
        },
      },
    ]);
    const r = payload(await handleCalendar(client, "calendar_suggest_time", { ...base, max_suggestions: 20 }));
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      resource: "freebusy",
      method: "query",
      jsonBody: { items: [{ id: "primary" }, { id: "a@example.com" }] },
    });
    // Working hours 9:00 to 17:00 London are 08:00 to 16:00 UTC. Busy until
    // 10:00 UTC, then 11:30 to 12:00 UTC.
    expect(r.suggestions.map((s: { start: string }) => s.start)).toEqual([
      "2026-10-19T10:00:00.000Z",
      "2026-10-19T12:00:00.000Z",
      "2026-10-19T13:00:00.000Z",
      "2026-10-19T14:00:00.000Z",
      "2026-10-19T15:00:00.000Z",
    ]);
    expect(r.suggestions[0].local).toBe("2026-10-19 11:00 to 12:00");
    expect(r.checked).toEqual(["primary", "a@example.com"]);
  });

  it("lists a calendar it could not read under could_not_check", async () => {
    const { client } = fakeClient([
      { data: { calendars: { primary: { busy: [] }, "a@example.com": { errors: [{ reason: "notFound" }] } } } },
    ]);
    const r = payload(await handleCalendar(client, "calendar_suggest_time", base));
    expect(r.could_not_check).toEqual([{ id: "a@example.com", reason: "notFound" }]);
    expect(r.checked).toEqual(["primary"]);
  });

  it("reads the primary calendar's time zone when none is given", async () => {
    const { client, calls } = fakeClient([{ data: { timeZone: "America/New_York" } }, { data: { calendars: { primary: {}, "a@example.com": {} } } }]);
    const { time_zone: _tz, ...rest } = base;
    const r = payload(await handleCalendar(client, "calendar_suggest_time", rest));
    expect(calls[0]).toMatchObject({ resource: "calendars", method: "get", params: { calendarId: "primary" } });
    expect(r.time_zone).toBe("America/New_York");
  });

  it.each([
    [{ duration_minutes: 2 }, /duration_minutes/],
    [{ duration_minutes: 30.5 }, /duration_minutes/],
    [{ time_max: "2026-12-01T00:00:00Z" }, /31 days/],
    [{ time_max: "2026-10-18T00:00:00Z" }, /time_max after time_min/],
    [{ time_zone: "Mars/Olympus" }, /IANA/],
    [{ working_hours_start: 18, working_hours_end: 9 }, /after working_hours_start/],
    [{ attendees: " , " }, /at least one attendee/],
  ])("refuses %o before any request", async (override, message) => {
    const { client, calls } = fakeClient([]);
    await expect(handleCalendar(client, "calendar_suggest_time", { ...base, ...override })).rejects.toThrow(message);
    expect(calls).toHaveLength(0);
  });
});

describe("calendar-slots arithmetic", () => {
  it("reads wall-clock times in a zone across a change of offset", () => {
    // New York leaves daylight time on 1 November 2026.
    expect(new Date(zonedToUtc(2026, 10, 30, 9, 0, "America/New_York")).toISOString()).toBe("2026-10-30T13:00:00.000Z");
    expect(new Date(zonedToUtc(2026, 11, 2, 9, 0, "America/New_York")).toISOString()).toBe("2026-11-02T14:00:00.000Z");
    expect(tzOffsetMinutes(Date.UTC(2026, 6, 1), "Asia/Kolkata")).toBe(330);
  });

  it("skips weekends unless asked, and puts every start on the quarter hour", () => {
    const opts = {
      windowStart: Date.parse("2026-10-23T08:07:00Z"), // a Friday
      windowEnd: Date.parse("2026-10-27T00:00:00Z"),
      durationMinutes: 30,
      dayStartHour: 9,
      dayEndHour: 10,
      timeZone: "UTC",
      max: 20,
    };
    const weekdays = freeSlots([], { ...opts, includeWeekends: false }).map(([s]) => new Date(s).toISOString());
    expect(weekdays).toEqual(["2026-10-23T09:00:00.000Z", "2026-10-23T09:30:00.000Z", "2026-10-26T09:00:00.000Z", "2026-10-26T09:30:00.000Z"]);
    const all = freeSlots([], { ...opts, includeWeekends: true });
    expect(all).toHaveLength(8);
    for (const [s] of all) expect(s % (15 * 60000)).toBe(0);
  });

  it("joins overlapping busy time", () => {
    expect(mergeBusy([[5, 10], [1, 3], [2, 6], [20, 30]])).toEqual([[1, 10], [20, 30]]);
  });
});

describe("drive_share_file", () => {
  it("creates a user permission at the role, then answers with the permission list", async () => {
    const { client, calls } = fakeClient([
      { data: { id: "p2" } },
      { data: { permissions: [{ id: "p1", type: "user", role: "owner", emailAddress: "me@example.com" }, { id: "p2", type: "user", role: "commenter", emailAddress: "b@example.com" }] } },
    ]);
    const r = payload(
      await handleDrive(client, "drive_share_file", { file_id: "f1", email: "b@example.com", role: "commenter", message: "For review" })
    );
    expect(calls[0]).toEqual({
      service: "drive",
      resource: "permissions",
      method: "create",
      params: { fileId: "f1", supportsAllDrives: true, sendNotificationEmail: true, emailMessage: "For review", fields: "id" },
      jsonBody: { type: "user", role: "commenter", emailAddress: "b@example.com" },
    });
    expect(calls[1]).toMatchObject({ resource: "permissions", method: "list", params: { fileId: "f1" } });
    expect(r).toMatchObject({ file_id: "f1", shared_with: "b@example.com", role: "commenter", notified: true });
    expect(r.permissions).toHaveLength(2);
  });

  it("with notify false sends no email and no message", async () => {
    const { client, calls } = fakeClient([{ data: {} }, { data: { permissions: [] } }]);
    await handleDrive(client, "drive_share_file", { file_id: "f1", email: "b@example.com", role: "reader", message: "x", notify: false });
    expect(calls[0].params).toEqual({ fileId: "f1", supportsAllDrives: true, sendNotificationEmail: false, fields: "id" });
  });

  it.each([
    [{ email: "b@example.com, c@example.com" }, /one email address/],
    [{ email: "not an address" }, /one email address/],
    [{ role: "owner" }, /role/],
    [{ file_id: "  " }, /file_id/],
  ])("refuses %o before any request", async (override, message) => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleDrive(client, "drive_share_file", { file_id: "f1", email: "b@example.com", role: "reader", ...override })
    ).rejects.toThrow(message);
    expect(calls).toHaveLength(0);
  });
});

describe("drive_get_file_permissions and drive_list_recent_files", () => {
  it("lists permissions compactly", async () => {
    const { client } = fakeClient([{ data: { permissions: [{ id: "anyoneWithLink", type: "anyone", role: "reader" }, { id: "d", type: "domain", role: "reader", domain: "example.com" }] } }]);
    const r = payload(await handleDrive(client, "drive_get_file_permissions", { file_id: "f1" }));
    expect(r).toEqual({
      file_id: "f1",
      permissions: [
        { id: "anyoneWithLink", type: "anyone", role: "reader" },
        { id: "d", type: "domain", role: "reader", domain: "example.com" },
      ],
    });
  });

  it("orders by when the account opened each file by default, and by modification on request", async () => {
    const opened = fakeClient([{ data: { files: [{ id: "f", name: "A", mimeType: "text/plain", modifiedTime: "m", viewedByMeTime: "v", webViewLink: "l" }] } }]);
    const r = payload(await handleDrive(opened.client, "drive_list_recent_files", { page_size: 500 }));
    expect(opened.calls[0].params).toMatchObject({ q: "trashed = false", orderBy: "viewedByMeTime desc", pageSize: 100 });
    expect(r.files[0]).toEqual({ id: "f", name: "A", mime_type: "text/plain", modified: "m", opened_by_me: "v", link: "l" });
    const modified = fakeClient([{ data: {} }]);
    expect(payload(await handleDrive(modified.client, "drive_list_recent_files", { by: "modified" }))).toEqual({ count: 0, files: [] });
    expect(modified.calls[0].params).toMatchObject({ orderBy: "modifiedTime desc" });
  });
});
