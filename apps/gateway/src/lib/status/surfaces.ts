import { ADMIN_ONLY_BUILTINS } from "@/gateway/admin-builtins";
import { PUBLICLY_UNLISTED_TOOLS } from "@/gateway/gws-run-access";

/**
 * The surfaces of the public status page (SCRUM-431), in the order it shows
 * them, keyed by the test runner's scenario keys. The scenario registry
 * already places every case in exactly one scenario; this file only names
 * them for the public and places the tools, which belong to no case.
 *
 * There is no agent surface: no scenario exercises the dashboard agent yet
 * (SCRUM-432). A scenario added later and missing here fails
 * `surfaces.test.ts`.
 */
export const SURFACES = [
  { key: "gmail", name: "Gmail" },
  { key: "calendar", name: "Calendar" },
  { key: "drive", name: "Drive" },
  { key: "docs", name: "Docs" },
  { key: "sheets", name: "Sheets" },
  { key: "slides", name: "Slides" },
  { key: "tasks", name: "Tasks" },
  { key: "contacts", name: "Contacts" },
  { key: "jira", name: "Jira" },
  { key: "confluence", name: "Confluence" },
  // Shown only once one of its tools is served: until the registry rows
  // exist the runner records Notion's cases as skipped, and a "not run"
  // section would announce a connector nobody can connect yet (SCRUM-366).
  { key: "notion", name: "Notion", servedOnly: true },
  { key: "skills", name: "Skills" },
  { key: "gateway", name: "Platform" },
] as const;

export type SurfaceKey = (typeof SURFACES)[number]["key"];

const KEYS = new Set<string>(SURFACES.map((s) => s.key));

/** A served tool's name without its plugin prefix: `gws-mcp__gmail_send`
 * is `gmail_send`. Built-ins have no prefix. */
export function bareToolName(name: string): string {
  const at = name.indexOf("__");
  return at === -1 ? name : name.slice(at + 2);
}

/** The surface a tool is shown under: the service its name starts with,
 * and Platform for the gateway's own tools (`echo`,
 * `list_connected_accounts`, `file_download_link`). */
export function surfaceOfTool(name: string): SurfaceKey {
  const service = bareToolName(name).split("_")[0];
  return (KEYS.has(service) ? service : "gateway") as SurfaceKey;
}

/**
 * Whether a member of the public is offered this tool. A run lists tools as
 * the admin who started it, so what it was served includes the runner's own
 * admin-only built-ins, and `gws_run`, which is never listed in public. The
 * page shows neither.
 */
export function isPublicTool(name: string): boolean {
  if (ADMIN_ONLY_BUILTINS.includes(name)) return false;
  if (PUBLICLY_UNLISTED_TOOLS.includes(name)) return false;
  return true;
}
