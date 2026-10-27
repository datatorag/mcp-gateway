import type { ToolsInput } from "@mastra/core/agent";
import { BUILT_IN_TOOLS } from "@/gateway/mcp-server";
import { NAMESPACE_SEPARATOR } from "@/gateway/plugin-manager";

/**
 * What a skill run is handed (SCRUM-376).
 *
 * A skill run prompts for nothing (SCRUM-223), so the tools it can call are
 * the whole of its safety. The rule is an ALLOWLIST BY FAMILY, decided from
 * what each tool declares, never a list of names to keep out:
 *
 * - connector tools: only the ones the skill names (SCRUM-238);
 * - gateway built-ins: only those that declare `approval: "read"` and no
 *   `audience`, so the skill-editing tools, file links, admin tools and the
 *   test runner are out, and a built-in added later as a write or for admins
 *   is out without anyone remembering to exclude it;
 * - introspection tools: only those that declare `requireApproval: false`.
 */

type BuiltinDecl = {
  definition: { name: string };
  approval: "read" | "write";
  audience?: string;
};

/** Whether a gateway built-in may be offered to a skill run: declared a read,
 * for everyone. A name that is not a registered built-in is refused. */
export function skillRunMayUseBuiltin(
  name: string,
  builtins: readonly BuiltinDecl[] = BUILT_IN_TOOLS
): boolean {
  const entry = builtins.find((b) => b.definition.name === name);
  return entry !== undefined && entry.approval === "read" && entry.audience === undefined;
}

/** The MCP tools a skill run may see: the connector tools its skill names
 * (bare names, matched after the namespace) and the read-only built-ins. */
export function skillRunTools<T extends { name: string }>(tools: T[], named: ReadonlySet<string>): T[] {
  return tools.filter((t) => {
    const sep = t.name.indexOf(NAMESPACE_SEPARATOR);
    if (sep === -1) return skillRunMayUseBuiltin(t.name);
    return named.has(t.name.slice(sep + NAMESPACE_SEPARATOR.length));
  });
}

/** The introspection tools a skill run may see: those that declare no
 * approval. `disconnect_service` declares one and is never offered. */
export function skillRunIntrospection(tools: ToolsInput): ToolsInput {
  return Object.fromEntries(
    Object.entries(tools).filter(
      ([, tool]) => (tool as { requireApproval?: unknown }).requireApproval === false
    )
  ) as ToolsInput;
}
