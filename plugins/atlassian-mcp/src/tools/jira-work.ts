import type { AtlassianClient } from "../atlassian-client.js";
import { jsonResponse } from "./response.js";

/** Worklogs and issue links (SCRUM-428): the two Jira surfaces the built-in
 * Atlassian connector has and this one did not. Kept beside jira.ts rather
 * than in it, because both carry their own validation and shaping. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = Record<string, any>;

/** The shape of a Jira issue key, e.g. PROJ-123. The same rule jira.ts holds
 * for its writes; every call here writes or reads by key alone. */
const ISSUE_KEY = /^[A-Za-z][A-Za-z0-9_]*-\d+$/;

function refuse(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function issueKeyError(value: unknown): string | null {
  return typeof value === "string" && ISSUE_KEY.test(value)
    ? null
    : `Not a Jira issue key: ${JSON.stringify(value)}. Expected the form PROJ-123. Nothing was sent.`;
}

function textToAdf(text: string) {
  return { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text }] }] };
}

/** Every string in an ADF document, in order, joined. A worklog comment comes
 * back as ADF; the caller wants the words. */
export function adfText(node: unknown): string {
  if (Array.isArray(node)) return node.map(adfText).join("");
  if (node && typeof node === "object") {
    const o = node as { type?: unknown; text?: unknown; content?: unknown };
    const here = typeof o.text === "string" ? o.text : "";
    const inner = o.content === undefined ? "" : adfText(o.content);
    return here + inner + (o.type === "paragraph" ? "\n" : "");
  }
  return "";
}

// ---------------------------------------------------------------------------
// Worklogs
// ---------------------------------------------------------------------------

/** Jira's duration format: weeks, days, hours and minutes, e.g. "1h 30m",
 * "2d", "45m". Checked here because Jira's own refusal of a bad one reads as
 * a field error on the worklog, not on the argument. */
const DURATION = /^\s*(\d+(\.\d+)?\s*[wdhm]\s*)+$/i;

/** Jira's `started` wants yyyy-MM-dd'T'HH:mm:ss.SSSZ with a numeric offset and
 * refuses ISO's "Z". The instant is kept and written in UTC. */
export function jiraStarted(value: string): string | null {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return `${new Date(t).toISOString().slice(0, 23)}+0000`;
}

function shapeWorklog(w: Json) {
  return {
    id: w.id ?? null,
    author: w.author ? { display_name: w.author.displayName ?? null, account_id: w.author.accountId ?? null } : null,
    time_spent: w.timeSpent ?? null,
    time_spent_seconds: w.timeSpentSeconds ?? null,
    started: w.started ?? null,
    comment: w.comment ? adfText(w.comment).trim() : null,
  };
}

export async function addWorklog(client: AtlassianClient, args: Json) {
  const keyError = issueKeyError(args.issue_key);
  if (keyError) return refuse(keyError);
  const timeSpent = args.time_spent;
  if (typeof timeSpent !== "string" || !DURATION.test(timeSpent)) {
    return refuse(`time_spent must be a Jira duration such as "1h 30m", "2d" or "45m"; got ${JSON.stringify(timeSpent)}. Nothing was logged.`);
  }
  let started = jiraStarted(new Date().toISOString());
  if (args.started !== undefined) {
    started = typeof args.started === "string" ? jiraStarted(args.started) : null;
    if (!started) return refuse(`started must be a date and time, such as 2026-10-19T09:00:00Z; got ${JSON.stringify(args.started)}. Nothing was logged.`);
  }
  const body: Json = { timeSpent: timeSpent.trim(), started };
  if (typeof args.comment === "string" && args.comment !== "") body.comment = textToAdf(args.comment);
  const key = args.issue_key as string;
  const created = (await client.jiraPost(`/issue/${encodeURIComponent(key)}/worklog`, body)) as Json;
  return jsonResponse({ issue_key: key, worklog: shapeWorklog(created) });
}

export async function listWorklogs(client: AtlassianClient, args: Json) {
  const keyError = issueKeyError(args.issue_key);
  if (keyError) return refuse(keyError);
  const max = Number.isInteger(args.max_results) ? Math.min(Math.max(args.max_results as number, 1), 5000) : 100;
  const key = args.issue_key as string;
  const data = (await client.jiraGet(`/issue/${encodeURIComponent(key)}/worklog?maxResults=${max}`)) as Json;
  const worklogs = Array.isArray(data.worklogs) ? data.worklogs.map(shapeWorklog) : [];
  return jsonResponse({
    issue_key: key,
    total: typeof data.total === "number" ? data.total : worklogs.length,
    total_time_spent_seconds: worklogs.reduce((sum: number, w: { time_spent_seconds: unknown }) => sum + (typeof w.time_spent_seconds === "number" ? w.time_spent_seconds : 0), 0),
    worklogs,
  });
}

// ---------------------------------------------------------------------------
// Issue links
// ---------------------------------------------------------------------------

interface LinkType {
  id: string;
  name: string;
  inward: string;
  outward: string;
}

async function linkTypes(client: AtlassianClient): Promise<LinkType[]> {
  const data = (await client.jiraGet("/issueLinkType")) as Json;
  return (Array.isArray(data.issueLinkTypes) ? data.issueLinkTypes : []).map((t: Json) => ({
    id: String(t.id ?? ""),
    name: String(t.name ?? ""),
    inward: String(t.inward ?? ""),
    outward: String(t.outward ?? ""),
  }));
}

/** One link as the issue it was read from sees it: the other issue, and the
 * phrase that reads from this issue to that one. Jira puts the OTHER issue
 * under outwardIssue when this issue is the outward side ("this blocks
 * that"), and under inwardIssue when it is the inward side. */
function shapeLink(l: Json) {
  const outward = l.outwardIssue !== undefined;
  const other = (outward ? l.outwardIssue : l.inwardIssue) ?? {};
  return {
    id: l.id ?? null,
    type: l.type?.name ?? null,
    relation: (outward ? l.type?.outward : l.type?.inward) ?? null,
    issue: {
      key: other.key ?? null,
      summary: other.fields?.summary ?? null,
      status: other.fields?.status?.name ?? null,
    },
  };
}

async function readLinks(client: AtlassianClient, key: string) {
  const issue = (await client.jiraGet(`/issue/${encodeURIComponent(key)}?fields=issuelinks`)) as Json;
  const links = issue.fields?.issuelinks;
  return (Array.isArray(links) ? links : []).map(shapeLink);
}

export async function linkIssues(client: AtlassianClient, args: Json) {
  for (const k of [args.issue_key, args.other_issue_key]) {
    const keyError = issueKeyError(k);
    if (keyError) return refuse(keyError);
  }
  const from = args.issue_key as string;
  const to = args.other_issue_key as string;
  if (from.toUpperCase() === to.toUpperCase()) return refuse("An issue cannot be linked to itself. Nothing was sent.");
  const wanted = typeof args.link_type === "string" ? args.link_type.trim().toLowerCase() : "";
  if (wanted === "") return refuse("link_type is required: a link type's name, or the phrase it reads with, such as blocks or relates to. Nothing was sent.");

  const types = await linkTypes(client);
  // By name, or by the phrase from issue_key's side. The inward phrase
  // ("is blocked by") reads the other way, so the two issues swap.
  const byOutward = types.find((t) => t.name.toLowerCase() === wanted || t.outward.toLowerCase() === wanted);
  const byInward = byOutward ? undefined : types.find((t) => t.inward.toLowerCase() === wanted);
  const type = byOutward ?? byInward;
  if (!type) {
    return refuse(
      `This Jira site has no link type ${JSON.stringify(args.link_type)}. Its types are: ${types.map((t) => `${t.name} (${t.outward} / ${t.inward})`).join("; ")}. Nothing was sent.`,
    );
  }
  const [outwardKey, inwardKey] = byInward ? [to, from] : [from, to];

  // Jira's issueLink resource names the two ends the other way round from
  // its link type's phrases: the issue sent as inwardIssue is the one the
  // OUTWARD phrase is said of. So "A blocks B" goes out as inwardIssue A,
  // outwardIssue B. The answer below is read back from Jira, so a link made
  // the wrong way round shows in it rather than in a later surprise.
  const body: Json = { type: { name: type.name }, inwardIssue: { key: outwardKey }, outwardIssue: { key: inwardKey } };
  if (typeof args.comment === "string" && args.comment !== "") body.comment = { body: textToAdf(args.comment) };
  await client.jiraPost("/issueLink", body);

  const links = await readLinks(client, from);
  const made = links.filter((l) => l.type === type.name && l.issue.key?.toUpperCase() === to.toUpperCase());
  return jsonResponse({ issue_key: from, linked: made, links });
}

export async function listIssueLinks(client: AtlassianClient, args: Json) {
  const keyError = issueKeyError(args.issue_key);
  if (keyError) return refuse(keyError);
  const key = args.issue_key as string;
  const [links, types] = await Promise.all([readLinks(client, key), linkTypes(client)]);
  return jsonResponse({ issue_key: key, links, link_types: types });
}
