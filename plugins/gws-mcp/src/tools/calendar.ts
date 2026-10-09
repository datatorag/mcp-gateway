import type { GwsClient } from "../gws-client.js";
import { CREATE, MUTATE, READ, ToolDef } from "./annotations.js";
import {
  jsonResponse,
  deleteResponse,
  stripHtml,
  truncate,
} from "./response.js";

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

function sendUpdatesParam(action: "invite" | "update" | "cancellation") {
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

    default:
      throw new Error(`Unknown Calendar tool: ${toolName}`);
  }
}
