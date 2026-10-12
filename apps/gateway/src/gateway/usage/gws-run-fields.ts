/**
 * Which raw API call a gws_run was (SCRUM-227, resource added by SCRUM-419).
 *
 * gws_run is one tool name over every Google API call the dedicated tools
 * do not cover, so its usage rows and events said nothing about what ran.
 * The three names that identify the call are lifted off its arguments and
 * carried as fields; the arguments themselves, the params and any body never
 * leave the call. Every other tool gets null in all three, so a filter on
 * any of them selects gws_run calls and nothing else.
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

function shortString(value: unknown, shape: RegExp = NAME): string | null {
  return typeof value === "string" && value.length <= MAX_LEN && shape.test(value) ? value : null;
}

export function gwsRunFields(
  toolName: string,
  args: Record<string, unknown> | undefined
): { service: string | null; resource: string | null; method: string | null } {
  const bare = toolName.includes("__") ? toolName.slice(toolName.indexOf("__") + 2) : toolName;
  if (bare !== GWS_RUN || !args) return { service: null, resource: null, method: null };
  return {
    service: shortString(args.service),
    resource: shortString(args.resource, RESOURCE),
    method: shortString(args.method),
  };
}
