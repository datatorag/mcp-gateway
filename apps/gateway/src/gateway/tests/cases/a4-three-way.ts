import type { TestCase } from "../types";

/**
 * A4 (tier 1): what a plugin serves, what the registry holds, and what the
 * gateway advertises, compared BY NAME.
 *
 * Comparing only the registry against a snapshot cannot catch this: both are
 * derived from the same source, so both go stale together and the case passes
 * green. Seven tools once sat live and invisible that way.
 *
 * The runner can do the leg an agent never could, because it is inside the
 * container and can ask each plugin process directly. This case is therefore
 * STRONGER in code than it was on the sheet, where leg three was a standing
 * skip for months.
 *
 * Names and not counts: a schema change does not move a count, and a count
 * that matches by coincidence reads exactly like agreement.
 */
export const a4ThreeWay: TestCase = {
  id: "A4",
  title: "plugin, registry and served list agree by name",
  tier: 1,
  covers: [],
  accounts: [],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const { tools } = (await ctx.rpc("tools/list")) as { tools: { name: string }[] };
    const served = new Set(tools.filter((t) => t.name.includes("__")).map((t) => t.name));

    const res = await ctx.http("/api/admin/tests/registry-surface");
    if (res.status !== 200) {
      throw new Error(`the three-way comparison endpoint answered ${res.status}`);
    }
    const surface = (await res.json()) as {
      plugins: { slug: string; live: string[] | null; registry: string[]; error?: string }[];
    };

    const problems: string[] = [];
    for (const plugin of surface.plugins) {
      if (plugin.live === null) {
        problems.push(`${plugin.slug}: its own list could not be read (${plugin.error ?? "no reason given"})`);
        continue;
      }
      const live = new Set(plugin.live.map((n) => `${plugin.slug}__${n}`));
      const registry = new Set(plugin.registry);

      const liveButUnregistered = [...live].filter((n) => !registry.has(n));
      const registeredButAbsent = [...registry].filter((n) => !live.has(n));
      const registeredButUnserved = [...registry].filter((n) => !served.has(n));

      ctx.evidence(
        `${plugin.slug}: plugin ${live.size}, registry ${registry.size}, served ${[...served].filter((n) => n.startsWith(`${plugin.slug}__`)).length}`
      );
      if (liveButUnregistered.length) problems.push(`${plugin.slug} serves but the registry lacks: ${liveButUnregistered.join(", ")}`);
      if (registeredButAbsent.length) problems.push(`${plugin.slug} is registered but does not serve: ${registeredButAbsent.join(", ")}`);
      if (registeredButUnserved.length) problems.push(`${plugin.slug} registered but not advertised to this identity: ${registeredButUnserved.join(", ")}`);
    }

    if (surface.plugins.length === 0) {
      throw new Error("no active plugin was compared, so this case would pass while checking nothing");
    }
    if (problems.length > 0) throw new Error(problems.join(" | "));
  },
};
