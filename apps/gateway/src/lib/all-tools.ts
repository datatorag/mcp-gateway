import type { Database } from "@datatorag-mcp/db";
import { BUILT_IN_TOOLS, isPublicBuiltin } from "@/gateway/mcp-server";
import { listPublicToolRows } from "@/gateway/user-tools";
import { NAMESPACE_SEPARATOR } from "@/gateway/plugin-manager";
import { CONNECTOR_REGISTRY } from "@/gateway/connectors/registry";
import { isPublicTool } from "@/lib/status/surfaces";
import { getConnector } from "./docs-connectors";

/**
 * Every tool an ordinary signed-in user is served once each public service
 * is connected, grouped for the all-tools docs page.
 *
 * Nothing here is a list of its own. The connector tools are
 * `listPublicToolRows`, the read a signed-out `tools/list` on /mcp is
 * answered from (active servers, enabled tools, the public pages' filter),
 * and the built-ins are the registry in `mcp-server.ts` with the same filter
 * that read is given. So the page, the open tool list, and what a new user
 * gets after connecting everything are one list.
 */

export interface ToolLine {
  /** The name as `tools/list` serves it. */
  name: string;
  /** The first sentence of the tool's own description. */
  summary: string;
}

export interface ToolGroup {
  /** The plugin's slug, or `BUILT_IN_GROUP_KEY`. */
  key: string;
  title: string;
  /** The connector's own tool page, with each tool's parameters. */
  toolsHref: string | null;
  /** The connector's docs page. */
  docsHref: string | null;
  tools: ToolLine[];
}

export const BUILT_IN_GROUP_KEY = "built-in";
const BUILT_IN_GROUP_TITLE = "Built-in tools";

type BuiltinEntry = {
  definition: { name: string; description: string };
  audience?: "admin";
  surfaces?: readonly ("mcp" | "agent")[];
};

/**
 * The built-ins an ordinary user's MCP client is served: none that declares
 * an audience, none kept off the MCP surface. The open tool list in
 * `server.ts` asks the same question of the same registry.
 */
export function servedBuiltins<T extends BuiltinEntry>(entries: readonly T[] = BUILT_IN_TOOLS as unknown as readonly T[]): T[] {
  return entries.filter(isPublicBuiltin);
}

const ABBREVIATION = /\b(e\.g|i\.e|vs|etc)$/;

/** A description's first sentence, from its first line. Tool descriptions
 * are written for a model and run to a paragraph; a list wants one line. */
export function toolSummary(description: string): string {
  const line = description.split("\n").map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  for (const m of line.matchAll(/[.!?](?=\s+[A-Z(]|$)/g)) {
    const end = m.index! + 1;
    if (ABBREVIATION.test(line.slice(0, end - 1))) continue;
    return line.slice(0, end);
  }
  return line;
}

/**
 * The served rows and built-ins as the page's groups: one per connector in
 * the registry's order, then any plugin with no connector record, then the
 * built-ins. Rows keep the order they were read in.
 *
 * The public filter is applied again here, to names, although the read
 * already applies it in SQL: a row of an admin-only connector or an unlisted
 * tool that reached this function by another read still never reaches a
 * page.
 */
export function groupServedTools(
  rows: readonly { namespacedName: string; description: string }[],
  builtins: readonly BuiltinEntry[]
): ToolGroup[] {
  const bySlug = new Map<string, ToolLine[]>();
  for (const r of rows) {
    if (!isPublicTool(r.namespacedName)) continue;
    const slug = r.namespacedName.split(NAMESPACE_SEPARATOR)[0];
    const lines = bySlug.get(slug) ?? [];
    lines.push({ name: r.namespacedName, summary: toolSummary(r.description) });
    bySlug.set(slug, lines);
  }

  const groups: ToolGroup[] = [];
  for (const c of CONNECTOR_REGISTRY) {
    const tools = bySlug.get(c.pluginSlug);
    if (!tools) continue;
    bySlug.delete(c.pluginSlug);
    const docs = getConnector(c.id);
    groups.push({
      key: c.pluginSlug,
      title: c.displayName,
      toolsHref: `/tools/${c.pluginSlug}`,
      docsHref: docs ? `/docs/${docs.slug}` : null,
      tools,
    });
  }
  for (const [slug, tools] of bySlug) {
    groups.push({ key: slug, title: slug, toolsHref: `/tools/${slug}`, docsHref: null, tools });
  }

  const builtinLines = servedBuiltins(builtins)
    .filter((t) => isPublicTool(t.definition.name))
    .map((t) => ({ name: t.definition.name, summary: toolSummary(t.definition.description) }));
  if (builtinLines.length > 0) {
    groups.push({ key: BUILT_IN_GROUP_KEY, title: BUILT_IN_GROUP_TITLE, toolsHref: null, docsHref: null, tools: builtinLines });
  }
  return groups;
}

/** The page's groups, read from the registry. Throws when the database
 * cannot be read; the page decides what to show then. */
export async function loadAllTools(db: Database): Promise<ToolGroup[]> {
  return groupServedTools(await listPublicToolRows(db), BUILT_IN_TOOLS);
}
