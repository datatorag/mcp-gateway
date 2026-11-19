/**
 * SCRUM-499. A raw gws_run call whose service, resource, and method a named
 * tool already covers answers with one leading line that names that tool and
 * what it adds. The call still runs and its answer follows unchanged: nothing
 * is refused, and the status and metering are the same.
 *
 * A line is given only when the named tool can do what the raw call asked. Each
 * entry lists the query parameters (and, for a method with a body, the body
 * fields) the named tool can express; a raw call that passes anything else gets
 * no line. A rule of `true` takes any value, a list takes only those values.
 * `named-tool-hints.test.ts` fails if an entry names a tool that is not
 * registered or a method that is not in the method table.
 */

type Rule = true | readonly (string | number | boolean)[];

interface NamedTool {
  tool: string;
  /** What the named tool adds over the raw call, as the line says it. */
  adds: string;
  params: Record<string, Rule>;
  /** Body fields the named tool can express; absent means no body. */
  body?: Record<string, Rule>;
  /** Fields the named tool requires, found in the params or the body. */
  required?: readonly string[];
}

/** Parameters that only shape the answer or reach a shared drive; any named
 * tool's answer is no worse for them. */
const NEUTRAL: Record<string, Rule> = {
  fields: true,
  prettyPrint: true,
  quotaUser: true,
  alt: ["json"],
  supportsAllDrives: true,
  supportsTeamDrives: true,
  includeItemsFromAllDrives: true,
};

const ME: Rule = ["me"];
const CHECKED = "named arguments that are checked before any request is sent";

export const NAMED_TOOL_FOR: Record<string, NamedTool> = {
  "gmail users.threads.get": {
    tool: "gmail_read_thread",
    adds: "every message of the conversation in one call, a body budget that keeps the newest messages, and a headers-only mode",
    params: { userId: ME, id: true, format: ["full", "metadata", "minimal"], metadataHeaders: true },
    required: ["id"],
  },
  "gmail users.messages.get": {
    tool: "gmail_read",
    adds: "a text-only view with flattened headers, the decoded body, and each attachment's part ID, without the raw MIME parts",
    params: { userId: ME, id: true, format: ["full", "metadata", "minimal"], metadataHeaders: true },
    required: ["id"],
  },
  "gmail users.messages.list": {
    tool: "gmail_search",
    adds: "each match with its sender, recipients, subject, date, snippet, and labels in one call, instead of IDs to read one by one",
    params: { userId: ME, q: true, maxResults: true },
    required: ["q"],
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
  "calendar calendarList.list": {
    tool: "calendar_list_calendars",
    adds: CHECKED,
    params: { maxResults: true, pageToken: true },
  },
  "calendar events.list": {
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
      singleEvents: [true, "true"],
    },
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
    adds: "the document as text, or the part between two character indices",
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
  "slides presentations.get": {
    tool: "slides_get",
    adds: "an outline of each slide's text and element IDs instead of the full presentation",
    params: { presentationId: true },
  },
  "slides presentations.create": { tool: "slides_create", adds: CHECKED, params: {}, body: { title: true } },
  "slides presentations.batchUpdate": {
    tool: "slides_batch_update",
    adds: CHECKED,
    params: { presentationId: true },
    body: { requests: true },
  },
  "people people.searchContacts": {
    tool: "contacts_search",
    adds: CHECKED,
    params: { query: true, pageSize: true, readMask: true },
  },
  "people people.get": {
    tool: "contacts_get",
    adds: CHECKED,
    params: { resourceName: true, personFields: true },
  },
  "people people.deleteContact": { tool: "contacts_delete", adds: CHECKED, params: { resourceName: true } },
  "people people.searchDirectoryPeople": {
    tool: "contacts_directory_search",
    adds: CHECKED,
    params: { query: true, pageSize: true, readMask: true, sources: true },
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

function allowed(rule: Rule | undefined, value: unknown): boolean {
  if (rule === undefined) return false;
  if (rule === true) return true;
  return rule.includes(value as string | number | boolean);
}

function fits(given: Record<string, unknown>, rules: Record<string, Rule>): boolean {
  return Object.entries(given).every(([key, value]) => allowed(rules[key], value));
}

/** One parent is all the named tool takes, as a string or a one-item list. */
function singleParent(parents: unknown): boolean {
  if (parents === undefined || typeof parents === "string") return true;
  return Array.isArray(parents) && parents.length <= 1;
}

/**
 * The leading line for a raw call a named tool covers, or undefined when no
 * named tool covers it or the call passes something the named tool cannot take.
 */
export function namedToolLine(
  service: string,
  resource: string,
  method: string,
  params: Record<string, unknown> | undefined,
  body: unknown
): string | undefined {
  const entry = NAMED_TOOL_FOR[`${service} ${resource}.${method}`];
  if (!entry) return undefined;
  const p = params ?? {};
  if (!fits(p, { ...NEUTRAL, ...entry.params })) return undefined;
  let b: Record<string, unknown> = {};
  if (body !== undefined && body !== null) {
    if (typeof body !== "object" || Array.isArray(body) || !entry.body) return undefined;
    b = body as Record<string, unknown>;
    if (!fits(b, entry.body)) return undefined;
  }
  if (!singleParent(p.parents) || !singleParent(b.parents)) return undefined;
  for (const key of entry.required ?? []) {
    if (p[key] === undefined && b[key] === undefined) return undefined;
  }
  return `${entry.tool} covers this call: ${entry.adds}.`;
}
