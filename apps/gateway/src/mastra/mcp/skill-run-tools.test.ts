/**
 * SCRUM-376: what a skill run is handed.
 *
 * A skill run prompts for nothing, so what it can call is the whole of its
 * safety. The rule is an allowlist by family, decided from what each tool
 * DECLARES, never a list of names to keep out: connector tools the skill
 * names, built-ins that declare a read and no admin audience, introspection
 * tools that declare no approval. A built-in added tomorrow as a write or for
 * admins is excluded without anyone remembering to exclude it.
 */

import { describe, expect, it } from "vitest";
import { BUILT_IN_TOOLS } from "@/gateway/mcp-server";
import { REGISTRY_TOOL_NAMES } from "@/gateway/playground/registry-snapshot";
import { readSkillFiles } from "@/lib/skills";
import { skillRunIntrospection, skillRunMayUseBuiltin, skillRunTools } from "./skill-run-tools";

const builtinNames = BUILT_IN_TOOLS.map((t) => t.definition.name);
const def = (name: string) => ({ name, inputSchema: {} });

describe("a skill run's tool list", () => {
  const offered = skillRunTools(
    [...builtinNames, "gws-mcp__gmail_search", "gws-mcp__gmail_send", "atlassian-mcp__jira_search"].map(def),
    new Set(["gmail_search", "jira_search"])
  ).map((t) => t.name);

  it("has none of the skill-editing tools, no admin tool and no test runner", () => {
    for (const excluded of [
      "skills_create",
      "skills_update",
      "skills_fork",
      "skills_delete",
      "tests_run",
      "tests_status",
      "tests_results",
      "file_upload_link",
      "file_download_link",
    ]) {
      expect(offered, excluded).not.toContain(excluded);
    }
  });

  it("keeps the read-only built-ins and the connector tools the skill names, and no others", () => {
    expect(offered).toEqual(
      expect.arrayContaining(["skills_search", "skills_get", "list_connected_accounts", "gws-mcp__gmail_search", "atlassian-mcp__jira_search"])
    );
    expect(offered).not.toContain("gws-mcp__gmail_send");
  });

  it("excludes a NEW built-in by default unless it declares a read for everyone", () => {
    expect(skillRunMayUseBuiltin("future_admin_read", [{ definition: { name: "future_admin_read" }, approval: "read", audience: "admin" }])).toBe(false);
    expect(skillRunMayUseBuiltin("future_write", [{ definition: { name: "future_write" }, approval: "write" }])).toBe(false);
    expect(skillRunMayUseBuiltin("future_read", [{ definition: { name: "future_read" }, approval: "read" }])).toBe(true);
    // A name the registry does not hold at all is not a built-in it can trust.
    expect(skillRunMayUseBuiltin("not_registered")).toBe(false);
  });

  it("keeps introspection tools that declare no approval and drops the rest", () => {
    const kept = skillRunIntrospection({
      show_mcp_config: { requireApproval: false },
      request_connection: { requireApproval: false },
      disconnect_service: { requireApproval: true },
      undeclared: {},
    } as never);
    expect(Object.keys(kept).sort()).toEqual(["request_connection", "show_mcp_config"]);
  });
});

describe("every published skill still gets every tool it names", () => {
  it.each(readSkillFiles().map((s) => [s.slug, s] as const))("%s", (_slug, skill) => {
    const named = new Set(skill.tools);
    // What the run would be handed, from the full registry plus the built-ins.
    const offered = new Set(
      skillRunTools(
        [...builtinNames.map(def), ...[...REGISTRY_TOOL_NAMES].map((n) => def(`connector__${n}`))],
        named
      ).map((t) => t.name.split("__").pop()!)
    );
    for (const tool of skill.tools) {
      expect(offered.has(tool), `${skill.slug} names ${tool}, which a skill run would not receive`).toBe(true);
    }
  });
});
