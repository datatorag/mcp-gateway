import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import matter from "gray-matter";
import { describe, expect, it } from "vitest";
import { ADMIN_AUDIENCE_PLUGIN_SLUGS } from "@/app/dashboard/connections/service-registry";
import { REGISTRY_CLASSIFICATION } from "@/gateway/playground/registry-snapshot";
import { readSkillFiles } from "./skills";
import {
  DESCRIPTION_MAX,
  DESCRIPTION_MIN,
  USE_CASE_SERVICES,
  getAllUseCases,
  readUseCase,
  relatedUseCases,
  serviceNames,
  shortTool,
  useCasePassage,
  useCaseSearchTitle,
} from "./use-cases";

/** Every tool in the registry, by the name the gateway serves it under. */
const SERVED = new Set(REGISTRY_CLASSIFICATION.map(([name]) => name));

const GATEWAY = join(import.meta.dirname, "../..");
const DIR = join(GATEWAY, "content/use-cases");
const files = readdirSync(DIR)
  .filter((f) => f.endsWith(".md"))
  .map((f) => ({ slug: f.replace(/\.md$/, ""), data: matter(readFileSync(join(DIR, f), "utf8")).data }));

/** A whole record, to take one thing out of at a time. */
const GOOD = {
  title: "Do a thing",
  outcome: "Your agent does the thing.",
  description: "x".repeat(130),
  date: "2026-11-25",
  services: ["gmail"],
  accounts: "single",
  prompt: "Do the thing.",
  steps: [{ tool: "gws-mcp__gmail_search", label: "Find it" }],
  answer: "Done.",
  result: { kind: "text", lines: ["One line."] },
};
const problemsOf = (change: Record<string, unknown>, slug = "a-use-case") => readUseCase({ slug, data: { ...GOOD, ...change } }).problems;

describe("every use case record", () => {
  it("finds the records it is about to judge", () => {
    expect(files.length).toBeGreaterThanOrEqual(3);
  });

  it.each(files.map((f) => [f.slug, f] as const))("%s loads whole, with nothing missing", (_slug, file) => {
    const { useCase, problems } = readUseCase(file);
    expect(problems).toEqual([]);
    expect(useCase).not.toBeNull();
  });

  it("is listed: nothing on disk is left out of the list for being broken", () => {
    expect(getAllUseCases().map((u) => u.slug).sort()).toEqual(files.map((f) => f.slug).sort());
  });
});

describe("the honesty rules", () => {
  const useCases = getAllUseCases();

  it.each(useCases.map((u) => [u.slug, u] as const))("%s names only tools the registry serves to an ordinary user", (_slug, useCase) => {
    for (const step of useCase.steps) {
      expect(SERVED.has(step.tool), `${step.tool} is not a tool in the registry`).toBe(true);
      const server = step.tool.slice(0, step.tool.indexOf("__"));
      expect(ADMIN_AUDIENCE_PLUGIN_SLUGS.includes(server), `${step.tool} is an admin-only service's tool`).toBe(false);
      expect(shortTool(step.tool), `${step.tool} is not offered to everyone`).not.toBe("gws_run");
    }
  });

  it("the tool check can fail: a made-up tool and an admin-only one are not in what an ordinary user is served", () => {
    expect(SERVED.has("gws-mcp__gmail_teleport")).toBe(false);
    expect(SERVED.has("gws-mcp__gmail_search")).toBe(true);
    expect(ADMIN_AUDIENCE_PLUGIN_SLUGS).toContain("slack-mcp");
    expect(ADMIN_AUDIENCE_PLUGIN_SLUGS).toContain("brevo-mcp");
    expect(ADMIN_AUDIENCE_PLUGIN_SLUGS).toContain("posthog-mcp");
  });

  it.each(useCases.map((u) => [u.slug, u] as const))("%s names a skill and docs pages that exist", (_slug, useCase) => {
    if (useCase.skill) expect(readSkillFiles().map((s) => s.slug)).toContain(useCase.skill);
    for (const s of useCase.services) {
      expect(existsSync(join(GATEWAY, "content/docs", `${USE_CASE_SERVICES[s].docs}.md`)), s).toBe(true);
      expect(existsSync(join(GATEWAY, "public/icons/services", `${s}.svg`)), s).toBe(true);
    }
  });

  it.each(useCases.map((u) => [u.slug, u] as const))("%s holds sample content only, written by the house rules", (_slug, useCase) => {
    const everything = JSON.stringify(useCase);
    // No address of a real person or company, and no link out.
    expect(everything).not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
    expect(everything).not.toMatch(/https?:\/\//);
    expect(everything).not.toMatch(/[–—]/);
    expect(everything).not.toMatch(/\bassistants?\b/i);
  });
});

describe("a record with something missing fails, and says what", () => {
  it.each([
    [{ title: "" }, "title is missing"],
    [{ outcome: undefined }, "outcome is missing"],
    [{ description: "too short" }, `description must be ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX} characters (it is 9)`],
    [{ description: "x".repeat(DESCRIPTION_MAX + 1) }, `description must be ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX} characters (it is ${DESCRIPTION_MAX + 1})`],
    [{ date: "November 25" }, "date must be YYYY-MM-DD"],
    [{ prompt: "  " }, "prompt is missing"],
    [{ answer: undefined }, "answer is missing"],
    [{ services: [] }, "services must name at least one service"],
    [{ services: ["gmail", "gmail"] }, "services names a service twice"],
    [{ accounts: "several" }, 'accounts must be "single" or "multiple"'],
    [{ steps: [] }, "steps must list at least one step"],
    [{ steps: [{ tool: "gmail_search", label: "Find it" }] }, "step 1: tool must be a tool name as served, such as gws-mcp__gmail_search"],
    [{ steps: [{ tool: "gws-mcp__gmail_search" }] }, "step 1: label is missing"],
    [{ result: undefined }, "result is missing"],
    [{ result: { kind: "picture" } }, 'result.kind must be "text", "table", or "created"'],
    [{ result: { kind: "text", lines: [] } }, "result.lines must be a list of text lines"],
    [{ result: { kind: "table", columns: ["A", "B"], rows: [["1"]] } }, "every row of result.rows must have one cell per column"],
    [{ result: { kind: "created", title: "T", lines: ["l"] } }, "result.what is missing (for example: Draft, Jira issue)"],
    [{ skill: "Not A Slug" }, "skill must be a skill's slug"],
  ])("%j", (change, problem) => {
    expect(problemsOf(change)).toContain(problem);
    expect(readUseCase({ slug: "a-use-case", data: { ...GOOD, ...change } }).useCase).toBeNull();
  });

  it("names a service that is not one of ours, and a file name that is not a slug", () => {
    expect(problemsOf({ services: ["slack"] })[0]).toMatch(/^services names "slack", which is not one of gmail, /);
    expect(problemsOf({}, "Not_A_Slug")).toEqual(["the file name must be lowercase words joined by hyphens"]);
  });

  it("loads the whole record when nothing is wrong", () => {
    const { useCase, problems } = readUseCase({ slug: "a-use-case", data: GOOD });
    expect(problems).toEqual([]);
    expect(useCase).toMatchObject({ slug: "a-use-case", services: ["gmail"], steps: [{ tool: "gws-mcp__gmail_search", label: "Find it" }] });
    expect(useCase).not.toHaveProperty("skill");
  });
});

describe("what a record gives the page", () => {
  const useCases = getAllUseCases();
  const brief = useCases.find((u) => u.slug === "morning-brief-across-every-inbox")!;

  it("a title with the task, the services by their full names, and MCP", () => {
    expect(useCaseSearchTitle(brief)).toBe("Brief me on every inbox each morning: Gmail, Google Calendar, and Google Tasks MCP");
    expect(serviceNames(brief)).toBe("Gmail, Google Calendar, and Google Tasks");
  });

  it("a passage that stands alone: the outcome, DataToRAG, the agents, and the services", () => {
    const passage = useCasePassage(brief);
    expect(passage.startsWith(brief.outcome)).toBe(true);
    for (const word of ["DataToRAG", "Claude", "ChatGPT", "Cursor", "Gmail", "Google Calendar", "Google Tasks", "every account"]) {
      expect(passage, word).toContain(word);
    }
    const single = useCases.find((u) => u.accounts === "single")!;
    expect(useCasePassage(single)).not.toContain("every account");
  });

  it("a written description of 120 to 160 characters", () => {
    for (const u of useCases) {
      expect(u.description.length, u.slug).toBeGreaterThanOrEqual(DESCRIPTION_MIN);
      expect(u.description.length, u.slug).toBeLessThanOrEqual(DESCRIPTION_MAX);
    }
  });

  it("up to three related use cases, never itself, the ones sharing services first", () => {
    for (const u of useCases) {
      const related = relatedUseCases(u);
      expect(related.length).toBe(Math.min(3, useCases.length - 1));
      expect(related.map((r) => r.slug)).not.toContain(u.slug);
    }
    const email = useCases.find((u) => u.slug === "turn-an-email-thread-into-a-jira-issue")!;
    expect(relatedUseCases(email)[0].slug).toBe("morning-brief-across-every-inbox");
  });
});
