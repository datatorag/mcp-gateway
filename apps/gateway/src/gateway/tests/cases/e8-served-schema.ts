import type { TestCase } from "../types";

/**
 * E8 (smoke row E8, Gateway scenario): A4 compares NAMES. This compares the CONTRACT.
 *
 * A SCHEMA CHANGE DOES NOT MOVE A COUNT, so a count comparison is
 * structurally blind to it and always was. New parameters once shipped into
 * a plugin and no caller could reach them while every count agreed
 * (SCRUM-121, SCRUM-138). The named parameter is read from `tools/list`
 * rather than from the repo, because what matters is what a client is told.
 *
 * THE RUNNER SOLVES THIS CASE'S HARD PART BY CONSTRUCTION, which is worth
 * recording. The smoke row warns at length that a client session keeps the
 * tool surface it connected with (SCRUM-23), so a session that connected
 * before a registry write reads RED after the case has actually gone green,
 * and it tells the runner to score the served half unverifiable if it cannot
 * get a fresh connection. This runner builds a NEW in-process client for
 * every run, so its inventory is never stale and the served half is always
 * verifiable. The warning stays here because it is what makes the result
 * trustworthy, not because it is still a hazard.
 */
export const e8ServedSchema: TestCase = {
  id: "E8",
  title: "the served schema carries the parameters the registry was updated with",
  covers: [],
  accounts: [],
  run: async (ctx) => {
    const { tools } = (await ctx.rpc("tools/list")) as {
      tools: { name: string; inputSchema?: { properties?: Record<string, unknown> } }[];
    };

    // The standing named parameter, replaced when the registry next gains a
    // newer schema change. Say in the report which one was used.
    const expectations: [string, string][] = [
      ["gws-mcp__sheets_read", "value_render_option"],
      ["gws-mcp__sheets_update", "value_input_option"],
      ["gws-mcp__sheets_append", "value_input_option"],
    ];

    const missing: string[] = [];
    for (const [name, param] of expectations) {
      const tool = tools.find((t) => t.name === name);
      if (!tool) {
        // Not served is a different fact from served-without-the-parameter,
        // and conflating them would blame the schema for an absent tool.
        missing.push(`${name} is not served at all`);
        continue;
      }
      const has = Object.hasOwn(tool.inputSchema?.properties ?? {}, param);
      ctx.evidence(`${name} carries ${param}: ${has ? "yes" : "no"}`);
      if (!has) missing.push(`${name} does not carry ${param}`);
    }

    if (missing.length > 0) {
      throw new Error(
        `the served contract is behind the plugin: ${missing.join("; ")}. This is a registry write that has not happened, not a plugin defect.`
      );
    }
  },
};
