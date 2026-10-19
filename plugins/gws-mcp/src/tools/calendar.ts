import type { GwsClient } from "../gws-client.js";
import { CREATE, MUTATE, READ, ToolDef } from "./annotations.js";
import {
  jsonResponse,
  deleteResponse,
  stripHtml,
  truncate,
} from "./response.js";
import { requireNonBlank } from "./validate.js";
import { freeSlots, isTimeZone, localLabel } from "./calendar-slots.js";

interface RawAttendee {
  email?: string;
  self?: boolean;
  responseStatus?: string;
  optional?: boolean;
  resource?: boolean;
}

interface RawEvent {
  id?: string;
  summary?: string;
  status?: string;
  description?: string;
  location?: string;
  start?: unknown;
  end?: unknown;
  organizer?: { email?: string };
  attendees?: RawAttendee[];
  hangoutLink?: string;
  conferenceData?: {
    entryPoints?: { entryPointType?: string; uri?: string }[];
  };
  recurringEventId?: string;
  attachments?: { title?: string; fileUrl?: string }[];
  eventType?: string;
}

/** How many (non-resource) attendees a meeting can have before the compact
 * view collapses the roster to a count. Small meetings keep who's in them —
 * for a 1:1, the other party IS the information. */
const COMPACT_ROSTER_MAX = 10;

/** Bound on raw description size fed to the tag-stripper, so its regex
 * passes stay O(cap) on pathological multi-KB HTML blobs instead of
 * scanning the whole thing only to throw 99% away at truncation. */
const STRIP_INPUT_CAP = 10_000;

/** Calendar descriptions are free-form: plain text from humans, HTML from
 * Zoom/marketing/scheduling tools. Only run the tag-stripper when the text
 * actually looks like markup, so "a < b" in a human note survives. */
function descriptionText(description: string, maxChars: number): string {
  const capped =
    description.length > STRIP_INPUT_CAP
      ? // Drop any partial tag the cut leaves dangling, so the tag-strip
        // regex (which needs a closing ">") doesn't leak it as text.
        description.slice(0, STRIP_INPUT_CAP).replace(/<[^>]*$/, "")
      : description;
  const text = /<\/?[a-z][^>]*>/i.test(capped)
    ? stripHtml(capped)
    : capped.trim();
  return truncate(text, maxChars);
}

/** Compact per-event shape for the default calendar_list_events view.
 * Keeps what agenda/triage consumers use; drops the bloat that blows
 * response limits on busy calendars (full attendee rosters, reminders,
 * conferenceData, htmlLink). Room resources don't count as attendees. */
function compactEvent(event: RawEvent, maxDescriptionChars: number) {
  const out: Record<string, unknown> = {
    id: event.id,
    summary: event.summary,
    start: event.start,
    end: event.end,
  };
  if (event.status && event.status !== "confirmed") out.status = event.status;
  if (event.eventType && event.eventType !== "default") {
    out.event_type = event.eventType;
  }
  if (event.location) out.location = event.location;
  if (event.description && maxDescriptionChars !== 0) {
    const text = descriptionText(event.description, maxDescriptionChars);
    if (text) out.description = text;
  }
  if (event.organizer?.email) out.organizer = event.organizer.email;
  const attendees = (event.attendees ?? []).filter((a) => !a.resource);
  if (attendees.length > 0) {
    out.attendee_count = attendees.length;
    const self = attendees.find((a) => a.self);
    if (self?.responseStatus) out.my_response = self.responseStatus;
    if (attendees.length <= COMPACT_ROSTER_MAX) {
      out.attendees = attendees.map((a) => ({
        email: a.email,
        ...(a.responseStatus && a.responseStatus !== "needsAction"
          ? { response: a.responseStatus }
          : {}),
        ...(a.optional ? { optional: true } : {}),
      }));
    }
  }
  // Join link: Meet lives in hangoutLink; Zoom/Webex/etc. scheduled via
  // conference add-ons only appear in conferenceData entry points.
  const joinLink =
    event.hangoutLink ??
    event.conferenceData?.entryPoints?.find(
      (e) => e.entryPointType === "video" && e.uri
    )?.uri;
  if (joinLink) out.join_link = joinLink;
  if (event.recurringEventId) out.recurring = true;
  if (event.attachments && event.attachments.length > 0) {
    out.attachments = event.attachments.map((a) => ({
      title: a.title,
      fileUrl: a.fileUrl,
    }));
  }
  return out;
}

// Shared schema fragments — the same calendar_id block appeared in four
// tools and the send_updates block in three, differing only in which action
// the notification is about.
const calendarIdParam = {
  calendar_id: {
    type: "string",
    description: "Calendar ID (default: \"primary\")",
  },
} as const;

function sendUpdatesParam(action: "invite" | "update" | "cancellation" | "response") {
  return {
    send_updates: {
      type: "string",
      enum: ["all", "externalOnly", "none"],
      description: `Who to send ${action} notifications to (default: "all")`,
    },
  } as const;
}

export const calendarTools: ToolDef[] = [
  {
    name: "calendar_list_events",
    description:
      "List upcoming events from a Google Calendar. By default returns a compact view per event: id, title, start/end, location, plain-text description (HTML stripped, truncated), organizer email, attendee count plus your own response status, the full attendee roster when the meeting has 10 or fewer people, a recurring flag, attachments, and the video join link (Meet or conference-data providers like Zoom). Only large-meeting rosters, reminders, and raw HTML are dropped — use full for the raw Calendar API payload, or calendar_get_event for one event's complete detail.",
    inputSchema: {
      type: "object",
      properties: {
        calendar_id: {
          type: "string",
          description:
            "Calendar ID (default: \"primary\" for the user's main calendar)",
        },
        time_min: {
          type: "string",
          description:
            "Start of time range (ISO 8601, e.g., \"2024-06-01T00:00:00Z\"). Defaults to now.",
        },
        time_max: {
          type: "string",
          description:
            "End of time range (ISO 8601, e.g., \"2024-06-30T23:59:59Z\"). Defaults to 7 days from now.",
        },
        max_results: {
          type: "number",
          description: "Maximum number of events to return (default: 20)",
        },
        query: {
          type: "string",
          description: "Free-text search query to filter events",
        },
        page_token: {
          type: "string",
          description:
            "The nextPageToken from an earlier call with the same calendar, time range and query, to read the page of events after it.",
        },
        full: {
          type: "boolean",
          description:
            "Return the raw Calendar API response instead of the compact view: full attendee rosters, reminders, conferenceData, htmlLink, and original (often HTML) descriptions. On busy calendars this can be very large — prefer the default compact view for triage and agenda use.",
        },
        max_description_chars: {
          type: "number",
          description:
            "In the compact view, truncate each event's plain-text description to this many characters (default: 500; adds a truncation marker). Set to 0 to omit descriptions entirely. Ignored when full is true.",
        },
      },
      required: [],
    },
    annotations: READ("List calendar events"),
  },
  {
    name: "calendar_get_event",
    description:
      "Get details of a specific calendar event by its event ID. Returns the full event (all attendees, reminders, conference data), with the description converted to plain text; use full for the original (often HTML) description.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "The calendar event ID",
        },
        ...calendarIdParam,
        full: {
          type: "boolean",
          description:
            "Keep the description exactly as stored (often multi-KB HTML from Zoom/scheduling tools) instead of converting it to plain text.",
        },
      },
      required: ["event_id"],
    },
    annotations: READ("Get calendar event"),
  },
  {
    name: "calendar_create_event",
    description:
      "Create a new calendar event. Supports setting title, time, attendees, description, location, and Google Meet links.",
    inputSchema: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Event title",
        },
        start: {
          type: "string",
          description:
            "Start time in ISO 8601 format (e.g., \"2024-06-15T14:00:00-07:00\")",
        },
        end: {
          type: "string",
          description:
            "End time in ISO 8601 format (e.g., \"2024-06-15T15:00:00-07:00\")",
        },
        attendees: {
          type: "string",
          description:
            "Comma-separated email addresses of attendees",
        },
        description: {
          type: "string",
          description: "Event description or agenda",
        },
        location: {
          type: "string",
          description: "Event location (physical address or room name)",
        },
        add_meet: {
          type: "boolean",
          description:
            "Attach a Google Meet video conference link to the event (default: false)",
        },
        ...calendarIdParam,
        ...sendUpdatesParam("invite"),
      },
      required: ["summary", "start", "end"],
    },
    annotations: CREATE("Create calendar event"),
  },
  {
    name: "calendar_update_event",
    description:
      "Update an existing calendar event. Only provided fields are changed.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "The calendar event ID to update",
        },
        summary: {
          type: "string",
          description: "New event title",
        },
        start: {
          type: "string",
          description: "New start time (ISO 8601)",
        },
        end: {
          type: "string",
          description: "New end time (ISO 8601)",
        },
        attendees: {
          type: "string",
          description: "Comma-separated email addresses (replaces existing attendees)",
        },
        description: {
          type: "string",
          description: "New event description",
        },
        location: {
          type: "string",
          description: "New event location",
        },
        ...calendarIdParam,
        ...sendUpdatesParam("update"),
      },
      required: ["event_id"],
    },
    annotations: MUTATE("Update calendar event"),
  },
  {
    name: "calendar_delete_event",
    description: "Delete a calendar event by its event ID.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "The calendar event ID to delete",
        },
        ...calendarIdParam,
        ...sendUpdatesParam("cancellation"),
      },
      required: ["event_id"],
    },
    annotations: MUTATE("Delete calendar event"),
  },
  {
    name: "calendar_freebusy",
    description:
      "Check availability (free/busy) for one or more people over a time range. Useful for finding open slots to schedule meetings.",
    inputSchema: {
      type: "object",
      properties: {
        time_min: {
          type: "string",
          description: "Start of the time range to check (ISO 8601)",
        },
        time_max: {
          type: "string",
          description: "End of the time range to check (ISO 8601)",
        },
        emails: {
          type: "string",
          description:
            "Comma-separated email addresses to check availability for",
        },
      },
      required: ["time_min", "time_max", "emails"],
    },
    annotations: READ("Check calendar availability"),
  },
  {
    name: "calendar_respond_to_event",
    description:
      "Answers an invitation on the connected account's calendar: accepted, declined or tentative, with an optional note to the organizer. Takes the event ID and the response. The account has to be on the event's guest list; an event it is not invited to is refused with a message saying so. Returns the event ID, its title, the response now recorded and the note. With send_updates left at its default the organizer is told, as when a person answers in Google Calendar.",
    inputSchema: {
      type: "object",
      properties: {
        event_id: {
          type: "string",
          description: "The ID of the event to answer, as calendar_list_events and calendar_get_event return it.",
        },
        response: {
          type: "string",
          enum: ["accepted", "declined", "tentative"],
          description: "The answer to record: accepted, declined or tentative.",
        },
        comment: {
          type: "string",
          description: "An optional note to the organizer, shown beside the answer.",
        },
        ...calendarIdParam,
        ...sendUpdatesParam("response"),
      },
      required: ["event_id", "response"],
    },
    annotations: MUTATE("Answer a calendar invitation"),
  },
  {
    name: "calendar_list_calendars",
    description:
      "Lists the calendars on the connected account's calendar list: its own, shared ones it has added, and subscribed ones such as holidays. Returns one compact entry per calendar: its ID, title, whether it is the primary calendar, the account's access role (owner, writer, reader or freeBusyReader) and its time zone, plus a page token when more remain. The ID is what calendar_list_events and the other calendar tools take as calendar_id.",
    inputSchema: {
      type: "object",
      properties: {
        max_results: {
          type: "number",
          description: "The most calendars to return in one page (default: 50, at most 250).",
        },
        page_token: {
          type: "string",
          description: "The nextPageToken from an earlier call, to read the page after it.",
        },
      },
      required: [],
    },
    annotations: READ("List calendars"),
  },
  {
    name: "calendar_suggest_time",
    description:
      `Suggests meeting times when everyone named is free. Takes the attendees' addresses, a duration and a time range, and reads their free/busy along with the connected account's own. Returns candidate start and end times inside working hours, in order of time, each as an ISO time and as a local time in the time zone used. Working hours default to 9 to 17 in the account's primary calendar time zone, and weekends are skipped unless include_weekends is true. Starts fall on the quarter hour. An attendee whose free/busy cannot be read (another organization that does not share it, or a misspelled address) is listed under could_not_check, and the suggestions then leave that person out. The range can span at most 31 days. Nothing is booked; calendar_create_event books a chosen slot.`,
    inputSchema: {
      type: "object",
      properties: {
        attendees: {
          type: "string",
          description: "Comma-separated email addresses of the people to find a time for.",
        },
        duration_minutes: {
          type: "number",
          description: "How long the meeting is, in minutes (5 to 480).",
        },
        time_min: {
          type: "string",
          description: "Start of the range to search (ISO 8601).",
        },
        time_max: {
          type: "string",
          description: "End of the range to search (ISO 8601), at most 31 days after time_min.",
        },
        time_zone: {
          type: "string",
          description:
            'The IANA time zone working hours are read in, such as "Europe/London" (default: the primary calendar\'s time zone).',
        },
        working_hours_start: {
          type: "number",
          description: "The hour the working day starts, 0 to 23 (default: 9).",
        },
        working_hours_end: {
          type: "number",
          description: "The hour the working day ends, 1 to 24 (default: 17).",
        },
        include_weekends: {
          type: "boolean",
          description: "Whether Saturdays and Sundays can be suggested (default: false).",
        },
        include_self: {
          type: "boolean",
          description: "Whether the connected account's own calendar counts as busy time (default: true).",
        },
        max_suggestions: {
          type: "number",
          description: "The most slots to return (default: 5, at most 20).",
        },
      },
      required: ["attendees", "duration_minutes", "time_min", "time_max"],
    },
    annotations: READ("Suggest a meeting time"),
  },
];

function buildEventBody(args: Record<string, unknown>) {
  const body: Record<string, unknown> = {};

  if (args.summary) body.summary = args.summary;
  if (args.description) body.description = args.description;
  if (args.location) body.location = args.location;

  if (args.start) {
    body.start = { dateTime: args.start };
  }
  if (args.end) {
    body.end = { dateTime: args.end };
  }

  if (args.attendees) {
    body.attendees = (args.attendees as string)
      .split(",")
      .map((e) => ({ email: e.trim() }));
  }

  if (args.add_meet) {
    body.conferenceData = {
      createRequest: {
        requestId: `meet-${Date.now()}`,
        conferenceSolutionKey: { type: "hangoutsMeet" },
      },
    };
  }

  return body;
}

export async function handleCalendar(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  const calendarId = (args.calendar_id as string) || "primary";

  switch (toolName) {
    case "calendar_list_events": {
      const nowMs = Date.now();
      const params: Record<string, unknown> = {
        calendarId,
        timeMin: (args.time_min as string) || new Date(nowMs).toISOString(),
        timeMax:
          (args.time_max as string) ||
          new Date(nowMs + 7 * 24 * 60 * 60 * 1000).toISOString(),
        maxResults: (args.max_results as number) || 20,
        singleEvents: true,
        orderBy: "startTime",
      };
      if (args.query) params.q = args.query;
      // The compact view has always handed back a nextPageToken; this is the
      // argument that takes it (SCRUM-419).
      if (args.page_token) params.pageToken = args.page_token;

      const result = await client.api("calendar", "events", "list", {
        params,
      });
      if (args.full) return jsonResponse(result.data);

      const data = result.data as {
        summary?: string;
        timeZone?: string;
        nextPageToken?: string;
        items?: RawEvent[];
      };
      const maxDescriptionChars =
        (args.max_description_chars as number | undefined) ?? 500;
      const compact: Record<string, unknown> = {
        calendar: data.summary,
        timeZone: data.timeZone,
        events: (data.items ?? []).map((e) =>
          compactEvent(e, maxDescriptionChars)
        ),
      };
      if (data.nextPageToken) compact.nextPageToken = data.nextPageToken;
      return jsonResponse(compact);
    }

    case "calendar_get_event": {
      const result = await client.api("calendar", "events", "get", {
        params: { calendarId, eventId: args.event_id },
      });
      const event = result.data as RawEvent;
      if (!args.full && event?.description) {
        // Single-event detail keeps everything else raw; only the
        // description gets the HTML→text treatment (untruncated).
        event.description = descriptionText(event.description, Infinity);
      }
      return jsonResponse(event);
    }

    case "calendar_create_event": {
      const params: Record<string, unknown> = {
        calendarId,
        sendUpdates: (args.send_updates as string) || "all",
      };
      if (args.add_meet) {
        params.conferenceDataVersion = 1;
      }

      const result = await client.api("calendar", "events", "insert", {
        params,
        jsonBody: buildEventBody(args),
      });
      return jsonResponse(result.data);
    }

    case "calendar_update_event": {
      const result = await client.api("calendar", "events", "patch", {
        params: {
          calendarId,
          eventId: args.event_id,
          sendUpdates: (args.send_updates as string) || "all",
        },
        jsonBody: buildEventBody(args),
      });
      return jsonResponse(result.data);
    }

    case "calendar_delete_event": {
      await client.api("calendar", "events", "delete", {
        params: {
          calendarId,
          eventId: args.event_id,
          sendUpdates: (args.send_updates as string) || "all",
        },
      });
      return deleteResponse("Event");
    }

    case "calendar_freebusy": {
      const items = (args.emails as string)
        .split(",")
        .map((e) => ({ id: e.trim() }));

      const result = await client.api("calendar", "freebusy", "query", {
        jsonBody: {
          timeMin: args.time_min,
          timeMax: args.time_max,
          items,
        },
      });
      return jsonResponse(result.data);
    }

    case "calendar_respond_to_event":
      return respondToEvent(client, calendarId, args);

    case "calendar_list_calendars": {
      const params: Record<string, unknown> = {
        maxResults: Math.min(Math.max(1, Math.floor(Number(args.max_results) || 50)), 250),
        // The five facts a caller needs, and nothing else: an entry in full
        // carries colors, notification settings and conference properties,
        // which made this answer too large to be worth it (SCRUM-419).
        fields: "items(id,summary,primary,accessRole,timeZone),nextPageToken",
      };
      if (args.page_token) params.pageToken = args.page_token;
      const result = await client.api("calendar", "calendarList", "list", { params });
      const data = (result.data ?? {}) as {
        items?: { id?: string; summary?: string; primary?: boolean; accessRole?: string; timeZone?: string }[];
        nextPageToken?: string;
      };
      const calendars = (Array.isArray(data.items) ? data.items : []).map((c) => ({
        id: c.id,
        summary: c.summary,
        primary: c.primary === true,
        access_role: c.accessRole,
        time_zone: c.timeZone,
      }));
      return jsonResponse({
        count: calendars.length,
        calendars,
        ...(data.nextPageToken ? { nextPageToken: data.nextPageToken } : {}),
      });
    }

    case "calendar_suggest_time":
      return suggestTime(client, args);

    default:
      throw new Error(`Unknown Calendar tool: ${toolName}`);
  }
}

async function respondToEvent(client: GwsClient, calendarId: string, args: Record<string, unknown>) {
  const response = args.response as string;
  if (!["accepted", "declined", "tentative"].includes(response)) {
    throw new Error("calendar_respond_to_event: response must be accepted, declined or tentative.");
  }
  const eventId = requireNonBlank("calendar_respond_to_event", "event_id", args.event_id as string);
  const current = await client.api("calendar", "events", "get", {
    params: { calendarId, eventId, fields: "id,summary,attendees" },
  });
  const event = (current.data ?? {}) as {
    id?: string;
    summary?: string;
    attendees?: { email?: string; self?: boolean; responseStatus?: string; comment?: string }[];
  };
  const attendees = Array.isArray(event.attendees) ? event.attendees : [];
  const mine = attendees.findIndex((a) => a.self === true);
  if (mine === -1) {
    throw new Error(
      "calendar_respond_to_event: the connected account is not on this event's guest list, so there is no invitation to answer."
    );
  }
  // events.patch replaces the attendees list whole, so the list goes back
  // as it was read, with only this account's entry changed.
  const comment = typeof args.comment === "string" ? args.comment : undefined;
  const updated = attendees.map((a, i) =>
    i === mine ? { ...a, responseStatus: response, ...(comment !== undefined ? { comment } : {}) } : a
  );
  const result = await client.api("calendar", "events", "patch", {
    params: { calendarId, eventId, sendUpdates: (args.send_updates as string) || "all", fields: "id,summary,attendees" },
    jsonBody: { attendees: updated },
  });
  const after = (result.data ?? {}) as typeof event;
  const me = (Array.isArray(after.attendees) ? after.attendees : []).find((a) => a.self === true);
  return jsonResponse({
    event_id: after.id ?? eventId,
    summary: after.summary ?? event.summary,
    response: me?.responseStatus ?? response,
    ...(me?.comment !== undefined ? { comment: me.comment } : {}),
  });
}

const MAX_RANGE_MS = 31 * 24 * 3600 * 1000;

function boundedInt(name: string, value: unknown, fallback: number, min: number, max: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`calendar_suggest_time: ${name} must be a whole number from ${min} to ${max}.`);
  }
  return n;
}

async function suggestTime(client: GwsClient, args: Record<string, unknown>) {
  const attendees = String(args.attendees ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (attendees.length === 0) throw new Error("calendar_suggest_time: name at least one attendee.");
  const duration = boundedInt("duration_minutes", args.duration_minutes, NaN, 5, 480);
  const start = Date.parse(String(args.time_min ?? ""));
  const end = Date.parse(String(args.time_max ?? ""));
  if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
    throw new Error("calendar_suggest_time: time_min and time_max must be ISO 8601 times, with time_max after time_min.");
  }
  if (end - start > MAX_RANGE_MS) throw new Error("calendar_suggest_time: the range can span at most 31 days.");
  const dayStartHour = boundedInt("working_hours_start", args.working_hours_start, 9, 0, 23);
  const dayEndHour = boundedInt("working_hours_end", args.working_hours_end, 17, 1, 24);
  if (dayEndHour <= dayStartHour) throw new Error("calendar_suggest_time: working_hours_end must be after working_hours_start.");
  const max = boundedInt("max_suggestions", args.max_suggestions, 5, 1, 20);

  let timeZone = typeof args.time_zone === "string" && args.time_zone.trim() !== "" ? args.time_zone.trim() : "";
  if (timeZone === "") {
    const primary = await client.api("calendar", "calendars", "get", { params: { calendarId: "primary", fields: "timeZone" } });
    timeZone = ((primary.data ?? {}) as { timeZone?: string }).timeZone ?? "UTC";
  }
  if (!isTimeZone(timeZone)) throw new Error(`calendar_suggest_time: "${timeZone}" is not an IANA time zone.`);

  const includeSelf = args.include_self !== false;
  const ids = [...(includeSelf ? ["primary"] : []), ...attendees];
  const result = await client.api("calendar", "freebusy", "query", {
    jsonBody: {
      timeMin: new Date(start).toISOString(),
      timeMax: new Date(end).toISOString(),
      items: ids.map((id) => ({ id })),
    },
  });
  const calendars = ((result.data ?? {}) as {
    calendars?: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }>;
  }).calendars ?? {};
  const busy: [number, number][] = [];
  const checked: string[] = [];
  const couldNotCheck: { id: string; reason: string }[] = [];
  for (const id of ids) {
    const entry = calendars[id];
    if (!entry || (Array.isArray(entry.errors) && entry.errors.length > 0)) {
      couldNotCheck.push({ id, reason: entry?.errors?.[0]?.reason ?? "notFound" });
      continue;
    }
    checked.push(id);
    for (const b of entry.busy ?? []) busy.push([Date.parse(b.start), Date.parse(b.end)]);
  }

  const slots = freeSlots(busy, {
    windowStart: start,
    windowEnd: end,
    durationMinutes: duration,
    dayStartHour,
    dayEndHour,
    includeWeekends: args.include_weekends === true,
    timeZone,
    max,
  });
  return jsonResponse({
    time_zone: timeZone,
    duration_minutes: duration,
    working_hours: `${dayStartHour}:00-${dayEndHour}:00`,
    include_weekends: args.include_weekends === true,
    checked,
    could_not_check: couldNotCheck,
    suggestions: slots.map(([s, e]) => ({
      start: new Date(s).toISOString(),
      end: new Date(e).toISOString(),
      local: `${localLabel(s, timeZone)} to ${localLabel(e, timeZone).slice(11)}`,
    })),
  });
}
