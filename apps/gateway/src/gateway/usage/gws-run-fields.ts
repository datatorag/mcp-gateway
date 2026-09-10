/**
 * Which raw API call a gws_run was (SCRUM-227).
 *
 * gws_run is one tool name over every Google API call the dedicated tools
 * do not cover, so its usage rows and events said nothing about what ran.
 * The two names that identify the call are lifted off its arguments and
 * carried as fields; the arguments themselves, the params and any body never
 * leave the call. Every other tool gets null in both, so a filter on either
 * field selects gws_run calls and nothing else.
 */

const MAX_LEN = 64;
const GWS_RUN = "gws_run";
/** A Google service or method name: letters, digits, dots, underscores,
 * hyphens ("drive", "files.list", "spreadsheets.values"). Anything else is
 * not a name and does not get to be a dashboard dimension. */
const NAME = /^[A-Za-z0-9_.-]+$/;

function shortString(value: unknown): string | null {
  return typeof value === "string" && value.length <= MAX_LEN && NAME.test(value) ? value : null;
}

export function gwsRunFields(
  toolName: string,
  args: Record<string, unknown> | undefined
): { service: string | null; method: string | null } {
  const bare = toolName.includes("__") ? toolName.slice(toolName.indexOf("__") + 2) : toolName;
  if (bare !== GWS_RUN || !args) return { service: null, method: null };
  return { service: shortString(args.service), method: shortString(args.method) };
}
