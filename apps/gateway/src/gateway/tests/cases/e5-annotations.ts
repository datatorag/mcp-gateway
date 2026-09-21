import type { TestCase } from "../types";

/**
 * E5 (smoke row E5, Gateway scenario): the annotations on the wire are the ones we
 * think we ship.
 *
 * Read from `tools/list`, never from the repo: the point is what a CLIENT
 * is told. A plugin can annotate its own tools, and the registry is written
 * by hand, so the two can disagree and only the wire settles it.
 *
 * What this does NOT do is treat an annotation as a permission. The gateway
 * classifies writes from the tool name against source-controlled lists
 * precisely because a plugin controls its own annotations; this case checks
 * HONESTY of the published surface, not enforcement.
 */
export const e5Annotations: TestCase = {
  id: "E5",
  title: "the served tool list carries read-only annotations that match the names",
  covers: [],
  accounts: [],
  run: async (ctx) => {
    const { tools } = (await ctx.rpc("tools/list")) as {
      tools: { name: string; annotations?: { readOnlyHint?: boolean } }[];
    };
    const plugin = tools.filter((t) => t.name.includes("__"));
    const annotated = plugin.filter((t) => t.annotations?.readOnlyHint !== undefined);
    ctx.evidence(`${annotated.length} of ${plugin.length} plugin tools carry a readOnlyHint`);

    if (plugin.length === 0) throw new Error("no plugin tool is served, so there is nothing to check");
    if (annotated.length === 0) {
      throw new Error("not one served tool carries a readOnlyHint, so the annotations are not reaching the wire");
    }

    // A declared read whose NAME is a write verb is the disagreement worth
    // surfacing: it is the shape a mis-annotated destructive tool takes.
    const suspicious = annotated
      .filter((t) => t.annotations?.readOnlyHint === true)
      .filter((t) => /_(delete|create|update|send|append|clear|write|forward|reply|transition)(_|$)/.test(t.name));
    if (suspicious.length > 0) {
      throw new Error(
        `these tools are annotated read-only but named as writes: ${suspicious.map((t) => t.name).join(", ")}`
      );
    }
  },
};
