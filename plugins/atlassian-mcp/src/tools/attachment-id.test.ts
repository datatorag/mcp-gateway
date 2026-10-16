import { describe, expect, it } from "vitest";
import type { AtlassianClient } from "../atlassian-client.js";
import { handleJira } from "./jira.js";

/** An attachment's id must be the same value, of the same type, from every
 * tool that serves it (SCRUM-335).
 *
 * Jira lists an issue's attachments with string ids, but its
 * /attachment/{id} endpoint answers the same attachment with a numeric id.
 * Passed through as-is, jira_get_issue said "10000" and jira_get_attachment
 * said 10000, and a caller comparing the two concluded it had been handed a
 * different attachment. The fixtures below keep that difference exactly as
 * Jira serves it, so the tools, not the fixtures, have to agree. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse(res: { content: Array<{ text: string }> }): any {
  return JSON.parse(res.content[0].text);
}

const ATTACHMENT = {
  filename: "notes.txt",
  size: 12,
  mimeType: "text/plain",
  content: "https://example.atlassian.net/rest/api/3/attachment/content/10000",
};

/** Replies per path, the way the Jira API answers each one. */
function fakeClient(byPath: Record<string, unknown>) {
  return {
    async jiraGet(path: string) {
      if (!(path in byPath)) throw new Error(`unexpected request: ${path}`);
      return byPath[path];
    },
  } as unknown as AtlassianClient;
}

const jira = fakeClient({
  "/issue/PROJ-1": {
    key: "PROJ-1",
    fields: { summary: "An issue", attachment: [{ id: "10000", ...ATTACHMENT }] },
  },
  "/attachment/10000": { id: 10000, ...ATTACHMENT },
});

describe("an attachment id is a string from both tools", () => {
  it("jira_get_issue and jira_get_attachment serve the identical id", async () => {
    const issue = parse(await handleJira(jira, "jira_get_issue", { issue_key: "PROJ-1" }));
    const listed = issue.attachments[0].id;

    const fetched = parse(
      await handleJira(jira, "jira_get_attachment", { attachment_id: listed }),
    ).id;

    expect(fetched).toBe(listed);
    expect(typeof listed).toBe("string");
    expect(listed).toBe("10000");
  });

  it("still answers a caller that passes the id as a number", async () => {
    const res = parse(
      await handleJira(jira, "jira_get_attachment", { attachment_id: 10000 }),
    );
    expect(res.id).toBe("10000");
  });

  it("serves a missing id as null, never the string \"undefined\"", async () => {
    const client = fakeClient({
      "/issue/PROJ-2": { key: "PROJ-2", fields: { attachment: [{ ...ATTACHMENT }] } },
      "/attachment/1": { ...ATTACHMENT },
    });
    const issue = parse(await handleJira(client, "jira_get_issue", { issue_key: "PROJ-2" }));
    expect(issue.attachments[0].id).toBeNull();
    const fetched = parse(await handleJira(client, "jira_get_attachment", { attachment_id: "1" }));
    expect(fetched.id).toBeNull();
  });
});
