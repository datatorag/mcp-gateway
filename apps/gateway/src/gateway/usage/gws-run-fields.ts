/**
 * Which raw API call a gws_run was (SCRUM-227, resource added by SCRUM-419).
 *
 * gws_run is one tool name over every Google API call the dedicated tools
 * do not cover, so its usage rows and events said nothing about what ran.
 * The three names that identify the call, and the names of the parameters
 * it passed, are lifted off its arguments and carried as fields; argument
 * values, param values and body values never leave the call. Every other
 * tool gets null in all four, so a filter on any of them selects gws_run
 * calls and nothing else.
 *
 * The resource is the third name because service and method do not identify
 * a call on their own: "get" on gmail is a message or an attachment, "list"
 * on calendar is events or calendars. It is the dotted path the API names
 * the collection by ("users.messages.attachments"), which is a name the
 * same way the other two are.
 */

const MAX_LEN = 64;
const GWS_RUN = "gws_run";
/** A Google service or method name: letters, digits, dots, underscores,
 * hyphens ("drive", "files.list", "spreadsheets.values"). Anything else is
 * not a name and does not get to be a dashboard dimension. */
const NAME = /^[A-Za-z0-9_.-]+$/;

/** A resource path is held tighter than the other two (SCRUM-419): dotted
 * segments of letters and nothing else, which is the shape of every
 * resource the Workspace APIs name ("users.messages.attachments",
 * "calendarList"). A file id, a message id or a key carries a digit, a
 * hyphen or an underscore, so one typed into this argument by mistake is
 * dropped instead of recorded. A shape check, not a list of real resources:
 * a word made only of letters still passes. */
const RESOURCE = /^[A-Za-z]+(\.[A-Za-z]+)*$/;

/** The names of the parameters a call passed (SCRUM-419), never their
 * values: the model's choice of gws_run over a dedicated tool is often
 * explained by which parameter it needed. Only the top-level keys of
 * `params` and of the request body are read; a key is kept when it has the
 * shape of a parameter name and is short, and the list is sorted,
 * deduplicated and capped, so a call cannot widen the row. */
const PARAM_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
const MAX_PARAM_NAME_LEN = 32;
const MAX_PARAM_NAMES = 24;

function keysOf(value: unknown): string[] {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : [];
}

function paramNames(args: Record<string, unknown>): string | null {
  // The plugin sends json_body when given and body otherwise; read the same one.
  const body = args.json_body ?? args.body;
  const names = [...new Set([...keysOf(args.params), ...keysOf(body)])]
    .filter((key) => key.length <= MAX_PARAM_NAME_LEN && PARAM_NAME.test(key))
    .sort()
    .slice(0, MAX_PARAM_NAMES);
  return names.length > 0 ? names.join(",") : null;
}

export interface GwsRunFields {
  service: string | null;
  resource: string | null;
  method: string | null;
  /** Comma-joined parameter names, e.g. "calendarId,maxResults,timeMin". */
  paramNames: string | null;
}

const NONE: GwsRunFields = { service: null, resource: null, method: null, paramNames: null };

function shortString(value: unknown, shape: RegExp = NAME): string | null {
  return typeof value === "string" && value.length <= MAX_LEN && shape.test(value) ? value : null;
}

export function gwsRunFields(
  toolName: string,
  args: Record<string, unknown> | undefined
): GwsRunFields {
  const bare = toolName.includes("__") ? toolName.slice(toolName.indexOf("__") + 2) : toolName;
  if (bare !== GWS_RUN || !args) return NONE;
  return {
    service: shortString(args.service),
    resource: shortString(args.resource, RESOURCE),
    method: shortString(args.method),
    paramNames: paramNames(args),
  };
}
