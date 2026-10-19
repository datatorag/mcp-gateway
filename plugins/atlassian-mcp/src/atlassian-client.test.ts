import { afterEach, describe, expect, it, vi } from "vitest";
import { AtlassianClient, successBody } from "./atlassian-client.js";
import { handleJira } from "./tools/jira.js";

/** A write that succeeds with no body (SCRUM-428).
 *
 * Jira's issueLink endpoint answers 201 with an EMPTY body. The client parsed
 * every non-204 success as JSON, so jira_link_issues threw "Unexpected end of
 * JSON input" after Jira had made the link: found by the runner's JR12 on
 * prod, where the unit tests' fake client could never show it, because a
 * fake client answers whatever it is told and never parses a response.
 *
 * So this goes through the REAL client against a stubbed fetch that answers
 * exactly what Jira answers. */

const CLOUD = "cloud-1";
const JIRA = `https://api.atlassian.com/ex/jira/${CLOUD}/rest/api/3`;
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("a write that succeeds with an empty body", () => {
  it.each([
    [204, null],
    [201, ""],
    [201, "  \n"],
  ])("answers {} for a %s with body %j", async (status, body) => {
    expect(await successBody(new Response(body, { status }))).toEqual({});
  });

  it("still parses a body that is there", async () => {
    expect(await successBody(json({ id: "1" }, 201))).toEqual({ id: "1" });
  });

  it("jira_link_issues reports the link Jira made when the link answers an empty 201", async () => {
    const posted: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/oauth/token/accessible-resources")) {
          return json([{ id: CLOUD, name: "example", url: "https://example.atlassian.net" }]);
        }
        if (url === `${JIRA}/issueLinkType`) {
          return json({ issueLinkTypes: [{ id: "1", name: "Blocks", inward: "is blocked by", outward: "blocks" }] });
        }
        if (url === `${JIRA}/issueLink` && init?.method === "POST") {
          posted.push(JSON.parse(String(init.body)));
          // Exactly what Jira sends: 201 Created, no body.
          return new Response("", { status: 201 });
        }
        if (url === `${JIRA}/issue/PROJ-1?fields=issuelinks`) {
          return json({
            fields: {
              issuelinks: [
                { id: "77", type: { name: "Blocks", inward: "is blocked by", outward: "blocks" }, outwardIssue: { key: "PROJ-2", fields: { summary: "b" } } },
              ],
            },
          });
        }
        throw new Error(`unexpected ${init?.method ?? "GET"} ${url}`);
      })
    );

    const res = await handleJira(new AtlassianClient({ accessToken: "t" }), "jira_link_issues", {
      issue_key: "PROJ-1",
      other_issue_key: "PROJ-2",
      link_type: "Blocks",
    });
    const out = JSON.parse(res.content[0].text);
    expect(posted).toHaveLength(1);
    expect(out.linked).toEqual([{ id: "77", type: "Blocks", relation: "blocks", issue: { key: "PROJ-2", summary: "b", status: null } }]);
  });
});
