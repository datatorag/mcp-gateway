import { PERSON_FIELDS } from "./contacts.js";

/**
 * SCRUM-499. A raw gws_run call whose service, resource, and method a named
 * tool already handles answers with one leading line that names that tool.
 * The call still runs and its answer follows unchanged: nothing is refused,
 * and the status and metering are the same.
 *
 * "Covers" is said only when the named tool returns what the raw call asked
 * for. Each entry lists the query parameters (and, for a method with a body,
 * the body fields) under which that holds; a raw call that passes anything
 * else, asks for every page, or asks for a field mask the named tool does not
 * honor gets no line. A rule of `true` takes any value, a list takes only those
 * values, and a function decides. `named-tool-hints.test.ts` fails if an entry
 * names a tool that is not registered or a method that is not in the method
 * table.
 *
 * One entry describes instead of covering: a raw thread read, the call this
 * exists for, is answered with what `gmail_read_thread` returns, including
 * what it leaves out, so a caller who wanted another header or the HTML part
 * is not told it is covered.
 */

type Rule = true | readonly (string | number | boolean)[] | ((value: unknown) => boolean);

interface NamedTool {
  tool: string;
  /** What the named tool adds over the raw call. */
  adds: string;
  params: Record<string, Rule>;
  /** Body fields the named tool can express; absent means no body. */
  body?: Record<string, Rule>;
  /** Fields that must be present, in the params or the body. */
  required?: readonly string[];
  /** The whole line, when it describes rather than covers. */
  line?: string;
}

/** Parameters that change neither the request's effect nor the answer's
 * content. `fields` is not among them: most named tools return a fixed set of
 * fields, so a field mask is honored only where an entry says so. */
const NEUTRAL: Record<string, Rule> = {
  prettyPrint: true,
  quotaUser: true,
  alt: ["json"],
  supportsAllDrives: true,
  supportsTeamDrives: true,
  includeItemsFromAllDrives: true,
};

const ME: Rule = ["me"];
const CHECKED = "named arguments that are checked before any request is sent";

/** At most this many results, where the named tool reads each one with its own
 * request (gmail_search): a larger raw listing is one cheap call the named
 * tool would turn into many. */
const MAX_FANOUT = 25;
const atMost = (n: number) => (v: unknown) => Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= n;

/** A comma-separated field list (or an array) that names only fields the
 * named tool asks Google for. */
function within(allowed: string) {
  const set = new Set(allowed.split(","));
  return (v: unknown) => {
    const names = Array.isArray(v) ? v.map(String) : typeof v === "string" ? v.split(",") : [];
    return names.length > 0 && names.every((n) => set.has(n.trim()));
  };
}

const isTrue = (v: unknown) => v === true || v === "true";

export const NAMED_TOOL_FOR: Record<string, NamedTool> = {
  "gmail users.threads.get": {
    tool: "gmail_read_thread",
    adds: "",
    line:
      "gmail_read_thread reads this thread in one call: each message's from, to, cc, subject, date, decoded text body, and attachments, oldest to newest, with a body budget and a headers-only mode. It does not return other headers or the HTML part.",
    params: { userId: ME, id: true, format: ["full", "metadata", "minimal"], metadataHeaders: true, fields: true },
    required: ["id"],
  },
  "gmail users.messages.get": {
    // gmail_read answers the full message as Google sends it, so a field mask
    // or a header list asks for a part of what it returns.
    tool: "gmail_read",
    adds: "a text-only view with flattened headers, the decoded body, and each attachment's part ID, without the raw MIME parts",
    params: { userId: ME, id: true, format: ["full", "metadata", "minimal"], metadataHeaders: true, fields: true },
    required: ["id"],
  },
  "gmail users.messages.list": {
    tool: "gmail_search",
    adds: "each match with its sender, recipients, subject, date, snippet, and labels in one call, instead of IDs to read one by one",
    params: { userId: ME, q: true, maxResults: atMost(MAX_FANOUT) },
    required: ["q", "maxResults"],
  },
  "gmail users.messages.trash": { tool: "gmail_trash", adds: CHECKED, params: { userId: ME, id: true } },
  "gmail users.messages.untrash": { tool: "gmail_untrash", adds: CHECKED, params: { userId: ME, id: true } },
  "gmail users.threads.trash": { tool: "gmail_trash_thread", adds: CHECKED, params: { userId: ME, id: true } },
  "gmail users.threads.untrash": { tool: "gmail_untrash_thread", adds: CHECKED, params: { userId: ME, id: true } },
  "gmail users.drafts.list": {
    tool: "gmail_list_drafts",
    adds: CHECKED,
    params: { userId: ME, maxResults: true, q: true, pageToken: true },
  },
  "gmail users.drafts.delete": { tool: "gmail_delete_draft", adds: CHECKED, params: { userId: ME, id: true } },
  "gmail users.drafts.send": { tool: "gmail_send_draft", adds: CHECKED, params: { userId: ME }, body: { id: true } },
  "gmail users.labels.list": { tool: "gmail_list_labels", adds: CHECKED, params: { userId: ME } },
  "gmail users.labels.create": { tool: "gmail_create_label", adds: CHECKED, params: { userId: ME }, body: { name: true } },
  "gmail users.labels.delete": { tool: "gmail_delete_label", adds: CHECKED, params: { userId: ME, id: true } },
  "gmail users.settings.filters.list": { tool: "gmail_list_filters", adds: CHECKED, params: { userId: ME } },
  "calendar events.list": {
    // calendar_list_events always expands recurring events and reads a window
    // it defaults to the coming week, so only a call that does the same is
    // covered; its `full` argument returns each event as Google sends it.
    tool: "calendar_list_events",
    adds: "a compact list by default, with each description cut to a size you choose",
    params: {
      calendarId: true,
      timeMin: true,
      timeMax: true,
      maxResults: true,
      q: true,
      pageToken: true,
      updatedMin: true,
      showDeleted: true,
      orderBy: true,
      singleEvents: isTrue,
    },
    required: ["timeMin", "timeMax", "singleEvents", "maxResults"],
  },
  "calendar events.get": {
    tool: "calendar_get_event",
    adds: CHECKED,
    params: { calendarId: true, eventId: true },
    required: ["eventId"],
  },
  "calendar events.delete": {
    tool: "calendar_delete_event",
    adds: CHECKED,
    params: { calendarId: true, eventId: true, sendUpdates: true },
    required: ["eventId"],
  },
  "drive files.copy": {
    tool: "drive_copy_file",
    adds: "conversion to a Google Doc, Sheet, or Slides file, text recognition for a PDF or image, and the target folder, as named arguments",
    // Callers put the copy's name, type, and folder in the query parameters as
    // often as in the body; the named tool takes them either way.
    params: { fileId: true, ocrLanguage: true, name: true, mimeType: true, parents: true },
    body: { name: true, mimeType: true, parents: true },
    required: ["fileId", "name"],
  },
  "drive files.list": {
    tool: "drive_search",
    adds: CHECKED,
    params: { q: true, pageSize: true },
    required: ["q"],
  },
  "drive permissions.list": { tool: "drive_get_file_permissions", adds: CHECKED, params: { fileId: true } },
  "docs documents.get": {
    tool: "docs_get",
    adds: "the document as text, or the part between two character indices, besides the full document",
    params: { documentId: true },
  },
  "docs documents.create": { tool: "docs_create", adds: CHECKED, params: {}, body: { title: true } },
  "docs documents.batchUpdate": {
    tool: "docs_batch_update",
    adds: CHECKED,
    params: { documentId: true },
    body: { requests: true },
  },
  "sheets spreadsheets.values.get": {
    tool: "sheets_read",
    adds: "one range or several in one call",
    params: { spreadsheetId: true, range: true, valueRenderOption: true },
  },
  "sheets spreadsheets.values.clear": {
    tool: "sheets_clear",
    adds: CHECKED,
    params: { spreadsheetId: true, range: true },
  },
  "sheets spreadsheets.batchUpdate": {
    tool: "sheets_batch_update",
    adds: CHECKED,
    params: { spreadsheetId: true },
    body: { requests: true },
  },
  "slides presentations.create": { tool: "slides_create", adds: CHECKED, params: {}, body: { title: true } },
  "slides presentations.batchUpdate": {
    tool: "slides_batch_update",
    adds: CHECKED,
    params: { presentationId: true },
    body: { requests: true },
  },
  // The contacts tools ask Google for one fixed set of fields, so a call is
  // covered only when it asks for those fields or fewer.
  "people people.searchContacts": {
    tool: "contacts_search",
    adds: CHECKED,
    params: { query: true, pageSize: true, readMask: within(PERSON_FIELDS) },
  },
  "people people.get": {
    tool: "contacts_get",
    adds: CHECKED,
    params: { resourceName: true, personFields: within(PERSON_FIELDS) },
  },
  "people people.deleteContact": { tool: "contacts_delete", adds: CHECKED, params: { resourceName: true } },
  "people people.searchDirectoryPeople": {
    tool: "contacts_directory_search",
    adds: CHECKED,
    params: {
      query: true,
      pageSize: true,
      readMask: within(PERSON_FIELDS),
      sources: (v) => v === "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE" || (Array.isArray(v) && v.length === 1 && v[0] === "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE"),
    },
  },
  "tasks tasklists.list": { tool: "tasks_list", adds: CHECKED, params: {} },
  "tasks tasklists.insert": { tool: "tasks_create_tasklist", adds: CHECKED, params: {}, body: { title: true } },
  "tasks tasks.list": {
    tool: "tasks_list_tasks",
    adds: CHECKED,
    params: { tasklist: true, showCompleted: true, showHidden: true },
  },
  "tasks tasks.delete": { tool: "tasks_delete", adds: CHECKED, params: { tasklist: true, task: true } },
};

/** Own properties only: a parameter named `constructor` or `__proto__` is a
 * parameter, not a rule. */
function ruleFor(rules: Record<string, Rule>, key: string): Rule | undefined {
  return Object.hasOwn(rules, key) ? rules[key] : undefined;
}

function allowed(rule: Rule | undefined, value: unknown): boolean {
  if (rule === undefined) return false;
  if (rule === true) return true;
  if (typeof rule === "function") return rule(value);
  return rule.includes(value as string | number | boolean);
}

function fits(given: Record<string, unknown>, ...ruleSets: Record<string, unknown>[]): boolean {
  return Object.entries(given).every(([key, value]) =>
    ruleSets.some((rules) => allowed(ruleFor(rules as Record<string, Rule>, key), value))
  );
}

/** One parent is all the named tool takes, as a string or a one-item list. */
function singleParent(parents: unknown): boolean {
  if (parents === undefined || typeof parents === "string") return true;
  return Array.isArray(parents) && parents.length <= 1;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

function lineFor(
  service: string,
  resource: string,
  method: string,
  params: Record<string, unknown> | undefined,
  body: unknown,
  pageAll: boolean | undefined
): string | undefined {
  // No named tool reads every page of a listing.
  if (pageAll) return undefined;
  const key = `${service} ${resource}.${method}`;
  const entry = Object.hasOwn(NAMED_TOOL_FOR, key) ? NAMED_TOOL_FOR[key] : undefined;
  if (!entry) return undefined;
  const p = params ?? {};
  if (!isPlainObject(p) || !fits(p, NEUTRAL, entry.params)) return undefined;
  let b: Record<string, unknown> = {};
  if (body !== undefined && body !== null) {
    if (!isPlainObject(body)) return undefined;
    b = body;
    // An empty body is no body: callers send {} to a method whose body is empty.
    if (Object.keys(b).length > 0 && (!entry.body || !fits(b, entry.body))) return undefined;
  }
  if (!singleParent(p.parents) || !singleParent(b.parents)) return undefined;
  for (const field of entry.required ?? []) {
    if (!Object.hasOwn(p, field) && !Object.hasOwn(b, field)) return undefined;
  }
  return entry.line ?? `${entry.tool} covers this call: ${entry.adds}.`;
}

/**
 * The leading line for a raw call a named tool handles, or undefined. Never
 * throws: the Google call has already run when this is asked, and a line must
 * not turn its answer into an error.
 */
export function namedToolLine(
  service: string,
  resource: string,
  method: string,
  params: Record<string, unknown> | undefined,
  body: unknown,
  pageAll?: boolean
): string | undefined {
  try {
    return lineFor(service, resource, method, params, body, pageAll);
  } catch {
    return undefined;
  }
}
