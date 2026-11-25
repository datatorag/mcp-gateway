import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { planLimits } from "@/gateway/billing/plans";
import { CHAT_MAX_STEPS, SKILL_RUN_MAX_STEPS } from "@/mastra/run-steps";
import {
  docsValues,
  fillDocTokens,
  getAllDocs,
  getConnectorGroups,
  getDocBySlug,
  getDocNeighbors,
  getDocsSequence,
  getTopLevelDocs,
} from "./docs";

/* The reading order behind Previous and Next. It is the sidebar's order, built
   from the same two lists the sidebar renders, so a page's Next is the entry
   under it in the sidebar. */
describe("docs reading order", () => {
  const sequence = getDocsSequence().map((d) => d.slug);

  it("holds every docs page exactly once", () => {
    const all = getAllDocs().map((d) => d.slug);
    // Guards the guard: an empty collection would pass everything below.
    expect(all.length).toBeGreaterThan(10);
    // A page missing here has no Previous or Next and is in no sidebar list:
    // its `connector` names a connector that is not in the registry.
    expect(all.filter((slug) => !sequence.includes(slug))).toEqual([]);
    // A page listed twice is both an overview and a child page.
    expect(sequence.filter((slug, i) => sequence.indexOf(slug) !== i)).toEqual([]);
    expect(sequence.length).toBe(all.length);
  });

  it("is the sidebar's order: the general pages, then each connector's overview and its pages", () => {
    const sidebar = [
      ...getTopLevelDocs(),
      ...getConnectorGroups().flatMap((g) => [...(g.overview ? [g.overview] : []), ...g.pages]),
    ].map((d) => d.slug);
    expect(sequence).toEqual(sidebar);
  });

  it("keeps a connector's pages together", () => {
    // Two pages that share an `order` value across sections used to interleave.
    expect(getDocNeighbors("sheets").next?.slug).toBe("slides");
    expect(getDocNeighbors("gmail").prev?.slug).toBe("google-workspace");
    expect(getDocNeighbors("getting-started").next?.connector).toBeNull();
  });

  it("has no Previous on the first page, no Next on the last, and neither for an unknown slug", () => {
    expect(getDocNeighbors(sequence[0]).prev).toBeNull();
    expect(getDocNeighbors(sequence[sequence.length - 1]).next).toBeNull();
    expect(getDocNeighbors("no-such-page")).toEqual({ prev: null, next: null });
  });
});

/* Numbers a docs page states come from the code that enforces them. A page
   writes a named token, the loader fills it from `docsValues()`, and a token
   nobody defined stops the load rather than reaching a reader. */
describe("docs value tokens", () => {
  const count = (n: number) => n.toLocaleString("en-US");
  const free = planLimits("free");
  const pro = planLimits("pro");

  it("builds its values from the plan table and the step caps", () => {
    expect(docsValues()).toEqual({
      "plan.free.calls": count(free.monthlyIncluded),
      "plan.free.runs": count(free.agentRuns),
      "plan.pro.calls": count(pro.monthlyIncluded),
      "plan.pro.runs": count(pro.agentRuns),
      "run.steps.chat": count(CHAT_MAX_STEPS),
      "run.steps.skill": count(SKILL_RUN_MAX_STEPS),
    });
  });

  it("fills a known token, with or without spaces inside the braces", () => {
    const values = { "plan.free.calls": "7" };
    expect(fillDocTokens("Free has {{plan.free.calls}} calls.", values, "x")).toBe("Free has 7 calls.");
    expect(fillDocTokens("{{ plan.free.calls }} and {{plan.free.calls}}", values, "x")).toBe("7 and 7");
    expect(fillDocTokens("No tokens here.", values, "x")).toBe("No tokens here.");
  });

  it("stops on a token nobody defined, naming the token and the page", () => {
    expect(() => fillDocTokens("Pro has {{plan.pro.cals}} calls.", { "plan.pro.calls": "1" }, "plans-and-limits")).toThrow(
      /plans-and-limits.*\{\{plan\.pro\.cals\}\}/
    );
    // A name inherited from Object.prototype is not a value.
    expect(() => fillDocTokens("{{constructor}}", {}, "x")).toThrow(/\{\{constructor\}\}/);
  });

  it("leaves no token, whole or broken, in any loaded page", () => {
    const left = getAllDocs().flatMap((d) =>
      [d.html, d.content, d.description, ...d.faqs.flatMap((f) => [f.q, f.a])]
        .filter((text) => /\{\{|\}\}/.test(text))
        .map(() => d.slug)
    );
    expect(left).toEqual([]);
  });

  it("renders the plans page with the numbers the plan table returns", () => {
    const page = getDocBySlug("plans-and-limits");
    expect(page).not.toBeNull();
    const text = [page!.html, ...page!.faqs.map((f) => f.a)].join("\n");
    for (const n of [free.monthlyIncluded, free.agentRuns, pro.monthlyIncluded, pro.agentRuns]) {
      expect(text).toContain(count(n));
    }
  });

  it("keeps those numbers out of the plans page's own markdown", () => {
    // The other half: a number typed beside a token would still be on the
    // page after the plan table moved. No digit run of two or more in the
    // file, so every figure on the page is a token.
    const raw = readFileSync(path.join(process.cwd(), "content/docs/plans-and-limits.md"), "utf8");
    expect(raw).toMatch(/\{\{plan\.free\.calls\}\}/);
    expect(raw.match(/\d[\d,]+/g) ?? []).toEqual([]);
  });
});
