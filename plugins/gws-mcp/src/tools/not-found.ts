import type { GwsClient } from "../gws-client.js";
import { GwsApiError } from "../google-api/errors.js";
import { getDriveFileMeta } from "./drive-ops.js";
import { GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES } from "./office-files.js";

/**
 * SCRUM-493, SCRUM-495. When Google cannot find the thing an id names (or,
 * for Gmail, cannot read the string as an id at all), the
 * answer says what was not found, in which account, why that usually
 * happens and what to do next, instead of Google's bare "not found". One
 * table and one handler for every Google service the plugin calls, keyed on
 * the request that failed (its service, resource and path parameters),
 * never on the tool: a tool that reads something on the way to doing
 * something else is covered too, and so is gws_run. Google's own code and
 * reason follow the sentence. Nothing is retried in another account.
 */

/** Which call names the account the token opens, made only after a miss,
 * with access the token already has. */
type Whoami = "gmail" | "calendar" | "drive";

type Row = {
  /** What it is called in the answer. */
  app: string;
  kind: string;
  /** The path parameter that holds the id that was not found. */
  idParam: string;
  /** A second path parameter worth naming: the message an attachment is on,
   * the calendar an event is on, the task list a task is in. */
  within?: { param: string; label: string };
  reasons: string;
  /** What the rest of the sentence says about other accounts. Gmail's words
   * are its own and unchanged since SCRUM-493. */
  accounts?: string;
  whoami: Whoami;
  /** A check that can say, certainly, that the id names something else. */
  probe?: "gmail-thread" | "drive-type";
  /** Where a real id of this kind comes from, for an id the service cannot
   * read as an id at all (Gmail's 400 "Invalid id value"). */
  source?: string;
  /** The row to use when the request carries no `idParam`: a list of a
   * calendar's events names only the calendar. */
  withoutId?: string;
  /** Path parameters that make the miss about something this row does not
   * name: a permission id on a Drive permissions request. */
  notWith?: string[];
};

const DRIVE_REASONS =
  "It may have been deleted for good, it may not be shared with this account, or it may belong to another connected Google account.";
const OTHER_ACCOUNTS =
  "The account argument reads from another connected account, and list_connected_accounts names the connected accounts.";

/** `${service} ${resource}` to what an id there names. */
const ROWS: Readonly<Record<string, Row>> = {
  "gmail users.messages": {
    app: "Gmail",
    kind: "message",
    idParam: "id",
    reasons:
      "It may have been deleted for good, or it may belong to another connected Google account. gmail_search finds a message's current id.",
    accounts: "The account argument reads from another mailbox, and list_connected_accounts names the connected accounts.",
    whoami: "gmail",
    source: "A message's id comes from gmail_search, gmail_list or gmail_read.",
  },
  "gmail users.threads": {
    app: "Gmail",
    kind: "thread",
    idParam: "id",
    reasons:
      "It may have been deleted for good, or it may belong to another connected Google account. gmail_search returns each message's threadId.",
    accounts: "The account argument reads from another mailbox, and list_connected_accounts names the connected accounts.",
    whoami: "gmail",
    probe: "gmail-thread",
    source: "A thread's id is the threadId in a gmail_search, gmail_list or gmail_read answer.",
  },
  "gmail users.drafts": {
    app: "Gmail",
    kind: "draft",
    idParam: "id",
    reasons:
      "A draft stops existing once it is sent or deleted, and it may belong to another connected Google account. gmail_list_drafts lists the current drafts.",
    accounts: "The account argument reads from another mailbox, and list_connected_accounts names the connected accounts.",
    whoami: "gmail",
    source: "A draft's id comes from gmail_list_drafts.",
  },
  "gmail users.messages.attachments": {
    app: "Gmail",
    kind: "attachment",
    idParam: "id",
    within: { param: "messageId", label: "message" },
    reasons:
      "Gmail issues a new attachment id each time a message is read, so an id from an earlier read can stop working. gmail_read lists the message's attachments with their current ids and part ids.",
    accounts: "The account argument reads from another mailbox, and list_connected_accounts names the connected accounts.",
    whoami: "gmail",
    source: "An attachment's current id and part id come from gmail_read.",
  },
  "drive files": {
    app: "Google Drive",
    kind: "file or folder",
    idParam: "fileId",
    reasons: `${DRIVE_REASONS} A file in the trash is still found. drive_search finds a file's current id.`,
    whoami: "drive",
  },
  "drive permissions": {
    app: "Google Drive",
    kind: "file or folder",
    idParam: "fileId",
    notWith: ["permissionId"],
    reasons: `${DRIVE_REASONS} drive_search finds a file's current id.`,
    whoami: "drive",
  },
  "docs documents": {
    app: "Google Docs",
    kind: "document",
    idParam: "documentId",
    reasons: `${DRIVE_REASONS} drive_search finds a document's current id.`,
    whoami: "drive",
    probe: "drive-type",
  },
  "sheets spreadsheets": {
    app: "Google Sheets",
    kind: "spreadsheet",
    idParam: "spreadsheetId",
    reasons: `${DRIVE_REASONS} drive_search finds a spreadsheet's current id.`,
    whoami: "drive",
    probe: "drive-type",
  },
  "sheets spreadsheets.values": {
    app: "Google Sheets",
    kind: "spreadsheet",
    idParam: "spreadsheetId",
    reasons: `${DRIVE_REASONS} drive_search finds a spreadsheet's current id.`,
    whoami: "drive",
    probe: "drive-type",
  },
  "sheets spreadsheets.sheets": {
    app: "Google Sheets",
    kind: "spreadsheet",
    idParam: "spreadsheetId",
    reasons: `${DRIVE_REASONS} drive_search finds a spreadsheet's current id.`,
    whoami: "drive",
    probe: "drive-type",
  },
  "slides presentations": {
    app: "Google Slides",
    kind: "presentation",
    idParam: "presentationId",
    reasons: `${DRIVE_REASONS} drive_search finds a presentation's current id.`,
    whoami: "drive",
    probe: "drive-type",
  },
  "calendar events": {
    app: "Google Calendar",
    kind: "event",
    idParam: "eventId",
    within: { param: "calendarId", label: "calendar" },
    reasons:
      "It may have been deleted, it may be on another calendar, or it may belong to another connected Google account. calendar_list_events finds an event's current id.",
    whoami: "calendar",
    withoutId: "calendar calendars",
  },
  "calendar calendars": {
    app: "Google Calendar",
    kind: "calendar",
    idParam: "calendarId",
    reasons:
      "It may have been deleted, it may not be shared with this account, or it may belong to another connected Google account. calendar_list_calendars lists the calendars this account can see.",
    whoami: "calendar",
  },
  "calendar calendarList": {
    app: "Google Calendar",
    kind: "calendar",
    idParam: "calendarId",
    reasons:
      "It may have been deleted, it may not be in this account's calendar list, or it may belong to another connected Google account. calendar_list_calendars lists the calendars this account can see.",
    whoami: "calendar",
  },
  "people people": {
    app: "Google Contacts",
    kind: "contact",
    idParam: "resourceName",
    reasons:
      "It may have been deleted, or it may belong to another connected Google account. contacts_search finds a contact's current resource name.",
    whoami: "drive",
  },
  "tasks tasklists": {
    app: "Google Tasks",
    kind: "task list",
    idParam: "tasklist",
    reasons:
      "It may have been deleted, or it may belong to another connected Google account. tasks_list lists the task lists and their ids.",
    whoami: "drive",
  },
  "tasks tasks": {
    app: "Google Tasks",
    kind: "task",
    idParam: "task",
    within: { param: "tasklist", label: "task list" },
    reasons:
      "It may have been deleted, it may be in another task list, or it may belong to another connected Google account. tasks_list_tasks lists a task list's tasks and their ids.",
    whoami: "drive",
  },
};

/** Google Tasks answers a missing id with a 400 rather than a 404, in one of
 * two fixed messages. The reason alone ("invalid") also covers a malformed
 * field, so the message decides, and only these two count. */
const TASKS_MISSING: Readonly<Record<string, string>> = {
  "Invalid task list ID": "tasks tasklists",
  "Invalid task ID": "tasks tasks",
};

/** Gmail refuses an id that is not in its own format with a 400 whose reason
 * is "invalidArgument" and whose message is exactly "Invalid id value". The
 * reason alone also covers other bad arguments, so the message decides. */
function isMalformedGmailId(err: GwsApiError): boolean {
  return (
    err.status === 400 &&
    err.request?.service === "gmail" &&
    err.reason === "invalidArgument" &&
    err.message.includes('"Invalid id value"')
  );
}

/** The Google editor type a Drive-backed service opens, for the wrong-kind check. */
const EDITOR_TYPES: Readonly<Record<string, { name: string; tools: string }>> = {
  [GOOGLE_DOC]: { name: "a Google Doc", tools: "docs_" },
  [GOOGLE_SHEET]: { name: "a Google Sheet", tools: "sheets_" },
  [GOOGLE_SLIDES]: { name: "Google Slides", tools: "slides_" },
};
const EXPECTED_TYPE: Readonly<Record<string, string>> = { docs: GOOGLE_DOC, sheets: GOOGLE_SHEET, slides: GOOGLE_SLIDES };

/** The table row for an error, and the id it was about, or null. */
function rowFor(err: GwsApiError): { key: string; row: Row; id: string } | null {
  const request = err.request;
  if (!request) return null;
  let key: string | undefined;
  if (err.status === 404 || isMalformedGmailId(err)) key = `${request.service} ${request.resource}`;
  else if (err.status === 400 && request.service === "tasks" && err.reason === "invalid") {
    key = Object.entries(TASKS_MISSING).find(([words]) => err.message.includes(`"${words}"`))?.[1];
  }
  let row = key ? ROWS[key] : undefined;
  if (row?.withoutId && !request.pathParams[row.idParam]) {
    key = row.withoutId;
    row = ROWS[key];
  }
  if (!key || !row || row.notWith?.some((p) => request.pathParams[p])) return null;
  const id = request.pathParams[row.idParam];
  return id ? { key, row, id } : null;
}

/** The address of the account the token opens, or null when Google does not
 * say. One call, made only after a miss, with access the call already had. */
async function accountOf(client: GwsClient, whoami: Whoami): Promise<string | null> {
  try {
    let email: unknown;
    if (whoami === "gmail") {
      email = (await client.api("gmail", "users", "getProfile", { params: { userId: "me" } })).data;
      email = (email as { emailAddress?: unknown })?.emailAddress;
    } else if (whoami === "calendar") {
      // The primary calendar's id is the account's address.
      email = (await client.api("calendar", "calendars", "get", { params: { calendarId: "primary" } })).data;
      email = (email as { id?: unknown })?.id;
    } else {
      email = (await client.api("drive", "about", "get", { params: { fields: "user(emailAddress)" } })).data;
      email = (email as { user?: { emailAddress?: unknown } })?.user?.emailAddress;
    }
    return typeof email === "string" && email.includes("@") ? email : null;
  } catch {
    return null;
  }
}

/** A thread id that is really a message id: the message's own thread, when
 * Gmail has a message by that id. Certain, because it is Gmail's answer. */
async function threadOfMessage(client: GwsClient, id: string): Promise<string | null> {
  try {
    const msg = await client.api("gmail", "users.messages", "get", {
      params: { userId: "me", id, format: "minimal" },
    });
    const threadId = (msg.data as { threadId?: unknown })?.threadId;
    return typeof threadId === "string" && threadId !== "" ? threadId : null;
  } catch {
    return null;
  }
}

/** A Docs, Sheets or Slides id that Drive knows as a different Google editor
 * type: what it is, when Drive says so. Certain, because it is Drive's answer;
 * the other services answer such an id with the same 404 as a missing one. */
async function otherEditorType(client: GwsClient, service: string, id: string) {
  try {
    const meta = await getDriveFileMeta<{ mimeType?: string }>(client, id, "mimeType");
    const found = meta.mimeType ? EDITOR_TYPES[meta.mimeType] : undefined;
    return found && meta.mimeType !== EXPECTED_TYPE[service] ? found : null;
  } catch {
    return null;
  }
}

/** The words for a Google miss on an id, or null for any other error. */
export async function notFoundAnswer(client: GwsClient, err: unknown): Promise<string | null> {
  if (!(err instanceof GwsApiError)) return null;
  const match = rowFor(err);
  if (!match) return null;
  const { row, id } = match;
  const request = err.request!;
  const google = `(Google: ${err.status}${err.reason ? ` ${err.reason}` : ""}, ${err.message})`;
  if (err.status === 400 && row.source) {
    // Not a miss: the service cannot read the string as an id at all, so no
    // account was searched and none is named.
    return `${row.app} does not read ${id} as a ${row.kind} id, so nothing was looked up. ${row.source} ${google}`;
  }

  if (row.probe === "gmail-thread") {
    const threadId = await threadOfMessage(client, id);
    if (threadId && threadId !== id) {
      return (
        `${id} is a message id, not a thread id. That message belongs to thread ${threadId}, ` +
        `which is the id gmail_read_thread and the other thread tools take. ${google}`
      );
    }
  }
  if (row.probe === "drive-type") {
    const other = await otherEditorType(client, request.service, id);
    if (other) {
      return `${id} is ${other.name}, not a ${row.kind}, so ${row.app} cannot open it. The ${other.tools} tools open it. ${google}`;
    }
  }

  const account = await accountOf(client, row.whoami);
  const where =
    row.app === "Gmail"
      ? account
        ? ` in ${account}`
        : " in this Gmail account"
      : account
        ? ` in ${account}`
        : " in this Google account";
  const within = row.within && request.pathParams[row.within.param];
  const what = within ? `${row.kind} with the id ${id} on ${row.within!.label} ${within}` : `${row.kind} with the id ${id}`;
  return `${row.app} has no ${what}${where}. ${row.reasons} ${row.accounts ?? OTHER_ACCOUNTS} ${google}`;
}
