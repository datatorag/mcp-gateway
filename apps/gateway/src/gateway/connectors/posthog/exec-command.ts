/**
 * What may be known about a call to PostHog's `exec` tool (SCRUM-511)
 * without keeping any of it: its verb, and for the three verbs that name a
 * PostHog tool, that tool's name.
 *
 * `exec` takes one CLI-style string: `search <words>`, `info <tool>`,
 * `schema <tool> <field>`, `call [--json] [--confirm] <tool> <json>`. The
 * string holds the user's question and their data, so it is never recorded.
 * These two values are a closed vocabulary (six verbs) and a product's tool
 * name (lowercase kebab-case, as PostHog names its tools), which is behavior,
 * not content. Anything that does not have that shape is not kept.
 */

/** The verbs that change nothing in PostHog: they describe its tools. */
const READ_VERBS = ["help", "tools", "search", "info", "schema"] as const;
const VERBS = [...READ_VERBS, "call"] as const;
export type ExecVerb = (typeof VERBS)[number] | "other";

/** The verbs whose first argument is a PostHog tool's name. */
const NAMES_A_TOOL: ReadonlySet<string> = new Set(["info", "schema", "call"]);

/** A PostHog tool name: lowercase words joined by hyphens, at most 64 long. */
const TOOL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export interface ExecCommand {
  verb: ExecVerb;
  /** The PostHog tool the command names, when it names one of that shape. */
  tool?: string;
}

/** The verb and tool of an `exec` command. Never throws; a command that is
 * not a string, or starts with no known verb, is `other`. */
export function parseExecCommand(command: unknown): ExecCommand {
  if (typeof command !== "string") return { verb: "other" };
  // One command per request: only the first line is a command.
  const words = command.trim().split("\n", 1)[0].split(/\s+/);
  const verb = (VERBS as readonly string[]).includes(words[0]) ? (words[0] as ExecVerb) : "other";
  if (!NAMES_A_TOOL.has(verb)) return { verb };
  // Flags (`--json`, `--confirm`) come before the tool's name.
  const first = words.slice(1).find((w) => !w.startsWith("--"));
  return first !== undefined && first.length <= 64 && TOOL_NAME.test(first) ? { verb, tool: first } : { verb };
}

/** The detail a usage event carries after the tool's name: `call:query-trends`,
 * `info:query-trends`, `search`. Never the words searched for, the JSON
 * input, or a field path. */
export function execUsageDetail(args: Record<string, unknown>): string {
  const { verb, tool } = parseExecCommand(args.command);
  return tool ? `${verb}:${tool}` : verb;
}

/** Whether a call to `exec` can change something in PostHog. Only `call`
 * runs a PostHog tool; a command this does not recognise is treated as one
 * that can. */
export function execMayChangeData(args: Record<string, unknown>): boolean {
  const { verb } = parseExecCommand(args.command);
  return !(READ_VERBS as readonly string[]).includes(verb);
}
