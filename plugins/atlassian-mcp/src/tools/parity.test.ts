import { describe, expect, it } from "vitest";
import type { AtlassianClient } from "../atlassian-client.js";
import { allTools } from "./index.js";
import { handleJira } from "./jira.js";
import { countOccurrences, handleConfluence, pageText } from "./confluence.js";
import { jiraStarted } from "./jira-work.js";

/** SCRUM-428: worklogs, issue links and Confluence comment threads.
 *
 * A fake client cannot show what Jira or Confluence would answer, so what is
 * pinned here is the REQUEST each tool sends, and that every refusal happens
 * before any request at all. Each guard has its known-bad case beside the
 * good one. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;
type Call = { method: string; path: string; body?: unknown };

/** Answers each request from `routes` by method and path prefix, in order of
 * the first match, and records every call. A route that is an Error throws. */
function fake(routes: Array<[string, string, unknown]>) {
  const calls: Call[] = [];
  const answer = (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body });
    const hit = routes.find(([m, p]) => m === method && path.startsWith(p));
    if (!hit) throw new Error(`unexpected ${method} ${path}`);
    if (hit[2] instanceof Error) throw hit[2];
    return hit[2];
  };
  const client = {
    async jiraGet(path: string) { return answer("GET", path); },
    async jiraPost(path: string, body: unknown) { return answer("POST", path, body); },
    async confluenceV2Get(path: string) { return answer("GET", path); },
    async confluenceV2Post(path: string, body: unknown) { return answer("POST", path, body); },
  } as unknown as AtlassianClient;
  return { client, calls };
}

/** A tool answer is an error when it says so; the handlers' union types do
 * not all declare the flag. */
function failed(res: object): boolean {
  return (res as { isError?: boolean }).isError === true;
}

function parse(res: { content: Array<{ text: string }> }): Json {
  return JSON.parse(res.content[0].text);
}

const TYPES = {
  issueLinkTypes: [
    { id: "1", name: "Blocks", inward: "is blocked by", outward: "blocks" },
    { id: "2", name: "Relates", inward: "relates to", outward: "relates to" },
  ],
};

describe("jira_add_worklog", () => {
  it("posts the duration, a start Jira accepts, and the comment as ADF", async () => {
    const { client, calls } = fake([["POST", "/issue/PROJ-1/worklog", { id: "10", timeSpent: "1h 30m", timeSpentSeconds: 5400, started: "2026-10-19T09:00:00.000+0000", author: { displayName: "A", accountId: "x" } }]]);
    const out = parse(await handleJira(client, "jira_add_worklog", { issue_key: "PROJ-1", time_spent: " 1h 30m ", started: "2026-10-19T02:00:00-07:00", comment: "review" }));
    expect(calls).toHaveLength(1);
    expect(calls[0].body).toEqual({
      timeSpent: "1h 30m",
      started: "2026-10-19T09:00:00.000+0000",
      comment: { type: "doc", version: 1, content: [{ type: "paragraph", content: [{ type: "text", text: "review" }] }] },
    });
    expect(out.worklog).toMatchObject({ id: "10", time_spent_seconds: 5400, author: { display_name: "A" } });
  });

  it("writes started in UTC with a numeric offset, never Z", () => {
    expect(jiraStarted("2026-10-19T09:00:00Z")).toBe("2026-10-19T09:00:00.000+0000");
    expect(jiraStarted("not a date")).toBeNull();
  });

  it.each([
    [{ issue_key: "PROJ", time_spent: "1h" }, /Not a Jira issue key/],
    [{ issue_key: "PROJ-1", time_spent: "90" }, /Jira duration/],
    [{ issue_key: "PROJ-1", time_spent: "an hour" }, /Jira duration/],
    [{ issue_key: "PROJ-1", time_spent: "1h", started: "yesterday" }, /started must be/],
  ])("refuses %j before sending anything", async (args, message) => {
    const { client, calls } = fake([]);
    const res = await handleJira(client, "jira_add_worklog", args);
    expect(failed(res)).toBe(true);
    expect(res.content[0].text).toMatch(message);
    expect(calls).toHaveLength(0);
  });
});

describe("jira_list_worklogs", () => {
  it("shapes each worklog and totals the seconds", async () => {
    const { client, calls } = fake([["GET", "/issue/PROJ-1/worklog", {
      total: 2,
      worklogs: [
        { id: "1", timeSpent: "15m", timeSpentSeconds: 900, comment: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "one" }] }] } },
        { id: "2", timeSpent: "1h", timeSpentSeconds: 3600 },
      ],
    }]]);
    const out = parse(await handleJira(client, "jira_list_worklogs", { issue_key: "PROJ-1" }));
    expect(calls[0].path).toBe("/issue/PROJ-1/worklog?maxResults=100");
    expect(out.total).toBe(2);
    expect(out.total_time_spent_seconds).toBe(4500);
    expect(out.worklogs[0].comment).toBe("one");
    expect(out.worklogs[1].comment).toBeNull();
  });
});

describe("jira_link_issues", () => {
  const readBack = { fields: { issuelinks: [{ id: "77", type: TYPES.issueLinkTypes[0], outwardIssue: { key: "PROJ-2", fields: { summary: "b", status: { name: "To Do" } } } }] } };

  it("sends A blocks B as inwardIssue A, outwardIssue B, and answers from a read-back", async () => {
    const { client, calls } = fake([["GET", "/issueLinkType", TYPES], ["POST", "/issueLink", {}], ["GET", "/issue/PROJ-1?fields=issuelinks", readBack]]);
    const out = parse(await handleJira(client, "jira_link_issues", { issue_key: "PROJ-1", other_issue_key: "PROJ-2", link_type: "blocks" }));
    const post = calls.find((c) => c.method === "POST");
    expect(post?.body).toEqual({ type: { name: "Blocks" }, inwardIssue: { key: "PROJ-1" }, outwardIssue: { key: "PROJ-2" } });
    expect(out.linked).toEqual([{ id: "77", type: "Blocks", relation: "blocks", issue: { key: "PROJ-2", summary: "b", status: "To Do" } }]);
  });

  it("takes the type by name as well as by phrase", async () => {
    const { client, calls } = fake([["GET", "/issueLinkType", TYPES], ["POST", "/issueLink", {}], ["GET", "/issue/", readBack]]);
    await handleJira(client, "jira_link_issues", { issue_key: "PROJ-1", other_issue_key: "PROJ-2", link_type: "Blocks" });
    expect(calls.find((c) => c.method === "POST")?.body).toMatchObject({ inwardIssue: { key: "PROJ-1" }, outwardIssue: { key: "PROJ-2" } });
  });

  it("swaps the issues for the inward phrase, so A is blocked by B means B blocks A", async () => {
    const { client, calls } = fake([["GET", "/issueLinkType", TYPES], ["POST", "/issueLink", {}], ["GET", "/issue/", { fields: { issuelinks: [] } }]]);
    await handleJira(client, "jira_link_issues", { issue_key: "PROJ-1", other_issue_key: "PROJ-2", link_type: "is blocked by" });
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ type: { name: "Blocks" }, inwardIssue: { key: "PROJ-2" }, outwardIssue: { key: "PROJ-1" } });
  });

  it("refuses an unknown type with the site's types, and posts nothing", async () => {
    const { client, calls } = fake([["GET", "/issueLinkType", TYPES]]);
    const res = await handleJira(client, "jira_link_issues", { issue_key: "PROJ-1", other_issue_key: "PROJ-2", link_type: "parent of" });
    expect(failed(res)).toBe(true);
    expect(res.content[0].text).toMatch(/Blocks \(blocks \/ is blocked by\)/);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it.each([
    [{ issue_key: "PROJ-1", other_issue_key: "PROJ-1", link_type: "blocks" }, /itself/],
    [{ issue_key: "PROJ-1", other_issue_key: "nope", link_type: "blocks" }, /Not a Jira issue key/],
    [{ issue_key: "PROJ-1", other_issue_key: "PROJ-2" }, /link_type is required/],
  ])("refuses %j before any request", async (args, message) => {
    const { client, calls } = fake([]);
    const res = await handleJira(client, "jira_link_issues", args);
    expect(failed(res)).toBe(true);
    expect(res.content[0].text).toMatch(message);
    expect(calls).toHaveLength(0);
  });
});

describe("jira_list_issue_links", () => {
  it("reads each link from this issue's side, and lists the site's types", async () => {
    const { client } = fake([
      ["GET", "/issue/PROJ-2?fields=issuelinks", { fields: { issuelinks: [{ id: "77", type: TYPES.issueLinkTypes[0], inwardIssue: { key: "PROJ-1", fields: { summary: "a" } } }] } }],
      ["GET", "/issueLinkType", TYPES],
    ]);
    const out = parse(await handleJira(client, "jira_list_issue_links", { issue_key: "PROJ-2" }));
    expect(out.links).toEqual([{ id: "77", type: "Blocks", relation: "is blocked by", issue: { key: "PROJ-1", summary: "a", status: null } }]);
    expect(out.link_types.map((t: Json) => t.name)).toEqual(["Blocks", "Relates"]);
  });
});

describe("confluence_add_comment", () => {
  it("posts a footer comment when nothing else is asked", async () => {
    const { client, calls } = fake([["POST", "/footer-comments", { id: "c1", version: { number: 1 } }]]);
    const out = parse(await handleConfluence(client, "confluence_add_comment", { page_id: "9", body: "a <b>" }));
    expect(calls[0].body).toEqual({ pageId: "9", body: { representation: "storage", value: "<p>a &lt;b&gt;</p>" } });
    expect(out).toEqual({ id: "c1", version: 1, type: "footer", parent_id: null });
  });

  it("replies to an inline comment through the inline endpoint", async () => {
    const { client, calls } = fake([
      ["GET", "/footer-comments/c9", new Error("404")],
      ["GET", "/inline-comments/c9", { id: "c9" }],
      ["POST", "/inline-comments", { id: "c10", version: { number: 1 } }],
    ]);
    const out = parse(await handleConfluence(client, "confluence_add_comment", { page_id: "9", body: "yes", parent_comment_id: "c9" }));
    expect(calls.at(-1)).toMatchObject({ path: "/inline-comments", body: { parentCommentId: "c9" } });
    expect(out).toMatchObject({ type: "inline", parent_id: "c9" });
  });

  it("replies to a footer comment through the footer endpoint", async () => {
    const { client, calls } = fake([["GET", "/footer-comments/c1", { id: "c1" }], ["POST", "/footer-comments", { id: "c2" }]]);
    await handleConfluence(client, "confluence_add_comment", { page_id: "9", body: "yes", parent_comment_id: "c1" });
    expect(calls.at(-1)).toMatchObject({ path: "/footer-comments", body: { parentCommentId: "c1" } });
  });

  it("refuses a reply to a comment that cannot be read, and posts nothing", async () => {
    const { client, calls } = fake([["GET", "/footer-comments/", new Error("404")], ["GET", "/inline-comments/", new Error("404")]]);
    const res = await handleConfluence(client, "confluence_add_comment", { page_id: "9", body: "x", parent_comment_id: "nope" });
    expect(failed(res)).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });

  it("anchors an inline comment with the page's own match count and a 0-based index", async () => {
    const { client, calls } = fake([
      ["GET", "/pages/9?body-format=storage", { id: "9", body: { storage: { value: "<p>the plan</p><p>the <strong>plan</strong> &amp; more</p>" } } }],
      ["POST", "/inline-comments", { id: "i1" }],
    ]);
    const out = parse(await handleConfluence(client, "confluence_add_comment", { page_id: "9", body: "why", inline_text: "plan", inline_match: 2 }));
    expect(calls.at(-1)?.body).toMatchObject({
      pageId: "9",
      inlineCommentProperties: { textSelection: "plan", textSelectionMatchCount: 2, textSelectionMatchIndex: 1 },
    });
    expect(out).toMatchObject({ type: "inline", selection: "plan" });
  });

  it.each([
    [{ inline_text: "absent" }, /does not appear/],
    [{ inline_text: "plan", inline_match: 3 }, /appears 2 time/],
    [{ inline_text: "plan", inline_match: 0 }, /appears 2 time/],
    [{ inline_text: "   " }, /empty/],
    [{ inline_text: "plan", parent_comment_id: "c1" }, /do not go together/],
  ])("refuses %j and posts nothing", async (extra, message) => {
    const { client, calls } = fake([["GET", "/pages/9", { body: { storage: { value: "<p>plan plan</p>" } } }]]);
    const res = await handleConfluence(client, "confluence_add_comment", { page_id: "9", body: "x", ...extra });
    expect(failed(res)).toBe(true);
    expect(res.content[0].text).toMatch(message);
    expect(calls.some((c) => c.method === "POST")).toBe(false);
  });
});

describe("confluence_get_comments", () => {
  it("lists each thread in order, replies after their parent, with inline anchors", async () => {
    const { client } = fake([
      ["GET", "/pages/9/footer-comments", { results: [{ id: "f1" }] }],
      ["GET", "/pages/9/inline-comments", { results: [{ id: "i1", resolutionStatus: "open", properties: { inlineOriginalSelection: "plan" } }] }],
      ["GET", "/footer-comments/f1/children", { results: [{ id: "f2" }] }],
      ["GET", "/footer-comments/f2/children", { results: [] }],
      ["GET", "/inline-comments/i1/children", { results: [{ id: "i2" }] }],
      ["GET", "/inline-comments/i2/children", { results: [] }],
    ]);
    const out = parse(await handleConfluence(client, "confluence_get_comments", { page_id: "9" }));
    expect(out.map((c: Json) => [c.id, c.type, c.parent_id])).toEqual([
      ["f1", "footer", null],
      ["f2", "footer", "f1"],
      ["i1", "inline", null],
      ["i2", "inline", "i1"],
    ]);
    expect(out[2]).toMatchObject({ selection: "plan", resolution_status: "open" });
    expect(out[0]).not.toHaveProperty("selection");
  });
});

describe("page text for inline anchors", () => {
  it("decodes entities, numeric references included, and keeps a non-breaking space", () => {
    expect(pageText("<p>it&#8217;s A&amp;B&nbsp;now &#x2014;</p>")).toBe("it\u2019s A&B\u00a0now \u2014");
  });

  it("counts occurrences without overlap", () => {
    expect(countOccurrences("aaaa", "aa")).toBe(2);
    expect(countOccurrences("abc", "")).toBe(0);
  });
});

describe("annotations of the SCRUM-428 tools", () => {
  it.each([
    ["jira_list_worklogs", true],
    ["jira_list_issue_links", true],
    ["jira_add_worklog", false],
    ["jira_link_issues", false],
  ])("%s readOnlyHint is %s, and none is destructive", (name, readOnly) => {
    const tool = allTools.find((t) => t.name === name);
    expect(tool, `${name} is not registered`).toBeDefined();
    expect(tool?.annotations?.readOnlyHint).toBe(readOnly);
    expect(tool?.annotations?.destructiveHint).toBe(false);
  });
});
