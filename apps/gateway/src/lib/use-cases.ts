import { defineCollection, type ParsedFile } from "./content-collection";
import { listOf } from "./list-of";

/**
 * Use cases (SCRUM-514): one record per use case, a markdown file with
 * frontmatter in `content/use-cases/<slug>.md`. The record drives everything:
 * the card on `/use-cases`, its flow diagram, the page at
 * `/use-cases/<slug>`, its chat replay, its metadata, its structured data,
 * and its sitemap line. Adding a use case is one file.
 *
 * A record that is missing something is not loaded, and
 * `use-cases.test.ts` fails with its slug and what is wrong. The same test
 * holds the honesty rules: every tool a record names is one the registry
 * serves to an ordinary user.
 */

/** The services a use case may name, by the mark the site ships for each
 * (`public/icons/services/<id>.svg`), with its name and its docs page. */
export const USE_CASE_SERVICES = {
  gmail: { label: "Gmail", docs: "gmail" },
  calendar: { label: "Google Calendar", docs: "calendar" },
  drive: { label: "Google Drive", docs: "drive" },
  docs: { label: "Google Docs", docs: "docs" },
  sheets: { label: "Google Sheets", docs: "sheets" },
  slides: { label: "Google Slides", docs: "slides" },
  tasks: { label: "Google Tasks", docs: "tasks" },
  contacts: { label: "Google Contacts", docs: "contacts" },
  jira: { label: "Jira", docs: "jira" },
  confluence: { label: "Confluence", docs: "confluence" },
  notion: { label: "Notion", docs: "notion" },
} as const;

export type UseCaseServiceId = keyof typeof USE_CASE_SERVICES;

export function isUseCaseService(value: unknown): value is UseCaseServiceId {
  return typeof value === "string" && Object.hasOwn(USE_CASE_SERVICES, value);
}

export interface UseCaseStep {
  /** The tool as the gateway serves it: `<server>__<tool>`. */
  tool: string;
  /** What the step does, in plain words. */
  label: string;
}

/** What comes back, in one of three shapes. Sample content only. */
export type UseCaseResult =
  | { kind: "text"; lines: string[] }
  | { kind: "table"; columns: string[]; rows: string[][] }
  | { kind: "created"; what: string; title: string; lines: string[] };

export interface UseCase {
  slug: string;
  /** The task, as a person would ask for it. The page's one heading. */
  title: string;
  /** One sentence on the outcome. */
  outcome: string;
  /** The page's meta description: written for the record, 120 to 160
   * characters, never a cut-off first line. */
  description: string;
  /** ISO date the record was last changed; the sitemap's date. */
  date: string;
  services: UseCaseServiceId[];
  /** Whether it works across several connected accounts at once. */
  accounts: "single" | "multiple";
  /** What a person types. */
  prompt: string;
  steps: UseCaseStep[];
  /** One line the agent says before the result. */
  answer: string;
  result: UseCaseResult;
  /** The matching skill in the catalog, when there is one. */
  skill?: string;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const DESCRIPTION_MIN = 120;
export const DESCRIPTION_MAX = 160;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TOOL = /^[a-z0-9-]+__[a-z0-9_]+$/;

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : "");
const texts = (v: unknown): string[] | null =>
  Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === "string" && x.trim() !== "") ? (v as string[]).map((x) => x.trim()) : null;

function parseResult(raw: unknown, problems: string[]): UseCaseResult | null {
  if (raw === null || typeof raw !== "object") {
    problems.push("result is missing");
    return null;
  }
  const r = raw as Record<string, unknown>;
  if (r.kind === "text") {
    const lines = texts(r.lines);
    if (!lines) problems.push("result.lines must be a list of text lines");
    return lines ? { kind: "text", lines } : null;
  }
  if (r.kind === "table") {
    const columns = texts(r.columns);
    const rows = Array.isArray(r.rows) && r.rows.length > 0 ? r.rows.map((row) => texts(row)) : null;
    if (!columns) problems.push("result.columns must be a list of column names");
    if (!rows || rows.some((row) => row === null)) problems.push("result.rows must be a list of rows of text");
    else if (columns && rows.some((row) => row!.length !== columns.length)) problems.push("every row of result.rows must have one cell per column");
    return columns && rows && rows.every((row) => row !== null && row.length === columns.length)
      ? { kind: "table", columns, rows: rows as string[][] }
      : null;
  }
  if (r.kind === "created") {
    const what = text(r.what);
    const title = text(r.title);
    const lines = texts(r.lines);
    if (!what) problems.push("result.what is missing (for example: Draft, Jira issue)");
    if (!title) problems.push("result.title is missing");
    if (!lines) problems.push("result.lines must be a list of text lines");
    return what && title && lines ? { kind: "created", what, title, lines } : null;
  }
  problems.push('result.kind must be "text", "table", or "created"');
  return null;
}

/**
 * A record from its file, and everything wrong with it. The record is null
 * when anything is wrong: a use case is shown whole or not at all.
 */
export function readUseCase(file: Pick<ParsedFile, "slug" | "data">): { useCase: UseCase | null; problems: string[] } {
  const { slug, data } = file;
  const problems: string[] = [];
  if (!SLUG.test(slug)) problems.push("the file name must be lowercase words joined by hyphens");

  const title = text(data.title);
  const outcome = text(data.outcome);
  const date = text(data.date);
  const prompt = text(data.prompt);
  const answer = text(data.answer);
  if (!title) problems.push("title is missing");
  if (!outcome) problems.push("outcome is missing");
  const description = text(data.description);
  if (description.length < DESCRIPTION_MIN || description.length > DESCRIPTION_MAX) {
    problems.push(`description must be ${DESCRIPTION_MIN} to ${DESCRIPTION_MAX} characters (it is ${description.length})`);
  }
  if (!ISO_DATE.test(date)) problems.push("date must be YYYY-MM-DD");
  if (!prompt) problems.push("prompt is missing");
  if (!answer) problems.push("answer is missing");

  const services = Array.isArray(data.services) ? data.services : [];
  if (services.length === 0) problems.push("services must name at least one service");
  for (const s of services) if (!isUseCaseService(s)) problems.push(`services names "${String(s)}", which is not one of ${Object.keys(USE_CASE_SERVICES).join(", ")}`);
  if (new Set(services).size !== services.length) problems.push("services names a service twice");

  const accounts = data.accounts;
  if (accounts !== "single" && accounts !== "multiple") problems.push('accounts must be "single" or "multiple"');

  const rawSteps = Array.isArray(data.steps) ? data.steps : [];
  if (rawSteps.length === 0) problems.push("steps must list at least one step");
  const steps: UseCaseStep[] = [];
  rawSteps.forEach((raw, i) => {
    const step = (raw ?? {}) as Record<string, unknown>;
    const tool = text(step.tool);
    const label = text(step.label);
    if (!TOOL.test(tool)) problems.push(`step ${i + 1}: tool must be a tool name as served, such as gws-mcp__gmail_search`);
    if (!label) problems.push(`step ${i + 1}: label is missing`);
    if (TOOL.test(tool) && label) steps.push({ tool, label });
  });

  const result = parseResult(data.result, problems);

  const skill = data.skill === undefined ? undefined : text(data.skill);
  if (data.skill !== undefined && !SLUG.test(skill ?? "")) problems.push("skill must be a skill's slug");

  if (problems.length > 0 || !result) return { useCase: null, problems };
  return {
    useCase: {
      slug,
      title,
      outcome,
      description,
      date,
      services: services as UseCaseServiceId[],
      accounts: accounts as UseCase["accounts"],
      prompt,
      steps,
      answer,
      result,
      ...(skill ? { skill } : {}),
    },
    problems,
  };
}

const collection = defineCollection<UseCase>({
  dir: "use-cases",
  parse: (file) => readUseCase(file).useCase,
  // Newest first, then by title, so the order is the same on every build.
  sort: (a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title),
});

export function getAllUseCases(): UseCase[] {
  return collection.getAll();
}

export function getUseCaseBySlug(slug: string): UseCase | null {
  return collection.getBySlug(slug);
}

/** Up to `count` other use cases, the ones sharing the most services first. */
export function relatedUseCases(useCase: UseCase, count = 3): UseCase[] {
  const shared = (other: UseCase) => other.services.filter((s) => useCase.services.includes(s)).length;
  return getAllUseCases()
    .filter((u) => u.slug !== useCase.slug)
    .map((u, order) => ({ u, order, shared: shared(u) }))
    .sort((a, b) => b.shared - a.shared || a.order - b.order)
    .slice(0, count)
    .map((x) => x.u);
}

/** The names of a use case's services, as prose: "Gmail, Google Calendar, and Google Tasks". */
export function serviceNames(useCase: Pick<UseCase, "services">): string {
  return listOf(useCase.services.map((s) => USE_CASE_SERVICES[s].label));
}

/**
 * The passage under the heading: the outcome, then who does it and with
 * what, so the two sentences can be quoted with no page around them.
 */
export function useCasePassage(useCase: UseCase): string {
  const accounts = useCase.accounts === "multiple" ? ", across every account you have connected" : "";
  return `${useCase.outcome} DataToRAG gives an agent such as Claude, ChatGPT, or Cursor your ${serviceNames(useCase)} through one connection${accounts}, so the agent does this from a single request.`;
}

/**
 * The page's title: the task, the services by their full names, and MCP,
 * which are the words a person searches with. The brand is added by the
 * page.
 */
export function useCaseSearchTitle(useCase: UseCase): string {
  return `${useCase.title}: ${serviceNames(useCase)} MCP`;
}

/** The tool's own name, without the server it is served under. */
export function shortTool(tool: string): string {
  return tool.slice(tool.indexOf("__") + 2);
}
