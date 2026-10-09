import { describe, expect, it } from "vitest";
import type { AtlassianClient } from "../atlassian-client.js";
import { handleJira } from "./jira.js";
import { handleConfluence } from "./confluence.js";

/** These tests pin the SHAPE a tool hands back, not just that it hands
 * something back.
 *
 * The bug they exist for: jira_search returned rows of `{"id":"11110"}` and
 * nothing else, for as long as it did, while every check anyone had was
 * green. A numeric id is not a key: nothing downstream can resolve it
 * without another call per row, but the tool answered, the JSON parsed, and
 * no assertion anywhere said what a row is supposed to contain.
 *
 * A fake client cannot show a MISSING upstream response: it always supplies
 * one. So the load-bearing assertion here is not on the reply, it is on the
 * REQUEST: that jira_search still asks the API for fields. That is the
 * actual root cause, and it is the one thing a fixture can prove.
 *
 * Each guard below carries a known-bad case as well as a good one. A guard
 * that only ever sees healthy input starts passing the moment it stops
 * looking properly, and reads identically to protection while doing it. */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function parse(res: { content: Array<{ text: string }> }): any {
  return JSON.parse(res.content[0].text);
}

const SITE = "https://example.atlassian.net";

/** Records what the handler sent, and replies with whatever it is given. */
function fakeClient(reply: unknown, sink?: { path?: string; body?: unknown }) {
  return {
    async jiraPost(path: string, body: unknown) {
      if (sink) {
        sink.path = path;
        sink.body = body;
      }
      return reply;
    },
    async confluenceV1Get(path: string) {
      if (sink) sink.path = path;
      return reply;
    },
    async getSiteUrl() {
      return SITE;
    },
  } as unknown as AtlassianClient;
}

// ---------------------------------------------------------------------------
// The captured defect
// ---------------------------------------------------------------------------

/** VERBATIM production response, captured 2026-08-08 against a real site,
 * for the JQL "project = SCRUM ORDER BY created DESC". This is the payload
 * the endpoint returns when the request omits `fields`. It is kept exactly as
 * observed: it is the only thing here that is evidence rather than a
 * reconstruction. */
const IDS_ONLY_RESPONSE = {
  issues: [{ id: "11110" }, { id: "11109" }, { id: "11108" }],
  nextPageToken: "Ck1jcmVhdGVkJmNyZWF0ZWQ",
  isLast: false,
};

/** A full response, as the same endpoint answers once `fields` is requested.
 * Reconstructed from the documented issue schema rather than captured; the
 * live re-check happens through the deployed connector after rollout. */
const FULL_RESPONSE = {
  issues: [
    {
      id: "11110",
      key: "SCRUM-51",
      self: "https://api.atlassian.com/ex/jira/abc/rest/api/3/issue/11110",
      fields: {
        summary: "Wire the settings panel",
        status: { name: "In Progress" },
        priority: { name: "Medium" },
        assignee: { displayName: "A Person", accountId: "acct-1" },
      },
    },
    {
      id: "11109",
      key: "SCRUM-50",
      fields: {
        summary: "Unassigned and unprioritised",
        status: { name: "To Do" },
        priority: null,
        assignee: null,
      },
    },
  ],
  nextPageToken: "tok",
  isLast: false,
};

// ---------------------------------------------------------------------------
// Root cause: the request must ask for fields
// ---------------------------------------------------------------------------

describe("jira_search asks the API for the fields it promises", () => {
  /** The enhanced search endpoint returns bare ids unless `fields` is sent.
   * Everything else in this file is downstream of that one request property,
   * so this is the assertion that actually prevents a regression. */
  it("sends a non-empty fields list", async () => {
    const sink: { body?: unknown } = {};
    await handleJira(fakeClient(FULL_RESPONSE, sink), "jira_search", {
      jql: "project = SCRUM",
    });
    const body = sink.body as { fields?: string[] };
    expect(Array.isArray(body.fields), "no fields requested at all").toBe(true);
    expect(body.fields!.length).toBeGreaterThan(0);
  });

  it("asks for the specific fields the tool description names", async () => {
    const sink: { body?: unknown } = {};
    await handleJira(fakeClient(FULL_RESPONSE, sink), "jira_search", {
      jql: "project = SCRUM",
    });
    const body = sink.body as { fields: string[] };
    // Pinned in both directions (a guard that over-reaches gets deleted by
    // whoever it blocks): these must be requested, and `key` must NOT be,
    // because it is not a field. It arrives at the top level of each issue.
    expect(body.fields).toEqual(
      expect.arrayContaining(["summary", "status", "priority", "assignee"])
    );
    expect(body.fields).not.toContain("key");
  });

  it("still forwards the caller's jql and pagination token untouched", async () => {
    const sink: { body?: unknown } = {};
    await handleJira(fakeClient(FULL_RESPONSE, sink), "jira_search", {
      jql: "project = SCRUM ORDER BY created DESC",
      next_page_token: "abc",
    });
    expect(sink.body).toMatchObject({
      jql: "project = SCRUM ORDER BY created DESC",
      nextPageToken: "abc",
    });
  });
});

// ---------------------------------------------------------------------------
// Response shape, pinned against a known-bad
// ---------------------------------------------------------------------------

/** What every jira_search row must carry to be usable without a second call.
 * Returns the rows that FAIL, so a failure message names them. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowsMissingIdentity(rows: any[]): any[] {
  return rows.filter(
    (r) => typeof r?.key !== "string" || typeof r?.summary !== "string" || typeof r?.status !== "string"
  );
}

describe("jira_search rows are resolvable on their own", () => {
  it("carries key, summary and status for every row", async () => {
    const out = parse(
      await handleJira(fakeClient(FULL_RESPONSE), "jira_search", { jql: "x" })
    );
    expect(out.issues).toHaveLength(2);
    expect(rowsMissingIdentity(out.issues)).toEqual([]);
    expect(out.issues[0]).toMatchObject({
      key: "SCRUM-51",
      summary: "Wire the settings panel",
      status: "In Progress",
      priority: "Medium",
    });
    // A link a person can open, not the REST `self` endpoint.
    expect(out.issues[0].url).toBe(`${SITE}/browse/SCRUM-51`);
  });

  it("represents an empty field as null rather than dropping it", async () => {
    const out = parse(
      await handleJira(fakeClient(FULL_RESPONSE), "jira_search", { jql: "x" })
    );
    // JSON.stringify removes undefined outright, so an unset field would
    // vanish from the row and read as a shape change rather than an empty
    // value. Assert the KEY is present and the value is null.
    expect(out.issues[1]).toHaveProperty("assignee", null);
    expect(out.issues[1]).toHaveProperty("priority", null);
  });

  it("preserves the cursor so callers can page", async () => {
    const out = parse(
      await handleJira(fakeClient(FULL_RESPONSE), "jira_search", { jql: "x" })
    );
    expect(out.nextPageToken).toBe("tok");
    expect(out.isLast).toBe(false);
  });

  /** l-066: a guard that only ever sees good input can start passing by
   * failing to look. Feed rowsMissingIdentity the REAL broken payload and
   * confirm it still calls it broken. If this ever goes green-by-silence,
   * the assertions above are decorative. */
  it("its own check still recognises the ids-only response as broken", async () => {
    const out = parse(
      await handleJira(fakeClient(IDS_ONLY_RESPONSE), "jira_search", { jql: "x" })
    );
    const bad = rowsMissingIdentity(out.issues);
    expect(bad).toHaveLength(3);
    // And specifically: this is what shipped. An id, no key.
    expect(out.issues[0].key).toBeNull();
    expect(out.issues[0].id).toBe("11110");
    expect(out.issues[0].url).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// jira_create_issue: a link, not a REST endpoint
// ---------------------------------------------------------------------------

describe("jira_create_issue returns something a person can open", () => {
  const CREATED = {
    id: "11111",
    key: "SCRUM-52",
    self: "https://api.atlassian.com/ex/jira/abc/rest/api/3/issue/11111",
  };

  it("returns a browsable url alongside the key", async () => {
    const out = parse(
      await handleJira(fakeClient(CREATED), "jira_create_issue", {
        project_key: "SCRUM",
        summary: "s",
      })
    );
    expect(out.key).toBe("SCRUM-52");
    expect(out.url).toBe(`${SITE}/browse/SCRUM-52`);
  });

  /** The known-bad: `self` is a REST endpoint. It must never be what we
   * hand back as the url, and it must not be named as though it were one. */
  it("never presents the REST self endpoint as the url", async () => {
    const out = parse(
      await handleJira(fakeClient(CREATED), "jira_create_issue", {
        project_key: "SCRUM",
        summary: "s",
      })
    );
    expect(out.url).not.toContain("/rest/api/");
    expect(out.url).toContain("/browse/");
    // Still exposed, under a name that says what it is.
    expect(out.apiUrl).toBe(CREATED.self);
  });
});

// ---------------------------------------------------------------------------
// confluence_search: the link must resolve
// ---------------------------------------------------------------------------

describe("confluence_search rows carry a resolvable link", () => {
  /** A v1 CQL search result carries its link as `url`, relative to the
   * response's `_links.base`. */
  const CQL_RESPONSE = {
    _links: { base: "https://example.atlassian.net/wiki" },
    results: [
      {
        title: "Overview",
        url: "/spaces/DOCS/pages/131174/Overview",
        content: { id: "131174", title: "Overview", version: { number: 1 } },
      },
    ],
  };

  /** The shape the code USED to expect: a `_links.webui` on the result
   * itself. No such property exists on a search result, which is why every
   * row shipped link: null. Kept as the known-bad. */
  const OLD_ASSUMED_RESPONSE = {
    _links: { base: "https://example.atlassian.net/wiki" },
    results: [
      {
        title: "Overview",
        content: { id: "131174", title: "Overview", version: { number: 1 } },
      },
    ],
  };

  it("joins the result url onto the response base", async () => {
    const out = parse(
      await handleConfluence(fakeClient(CQL_RESPONSE), "confluence_search", {
        cql: "type=page",
      })
    );
    expect(out[0].link).toBe(
      "https://example.atlassian.net/wiki/spaces/DOCS/pages/131174/Overview"
    );
    expect(out[0]).toMatchObject({ id: "131174", title: "Overview", version: 1 });
  });

  it("falls back to the wrapped content's webui link", async () => {
    const out = parse(
      await handleConfluence(
        fakeClient({
          _links: { base: "https://example.atlassian.net/wiki" },
          results: [
            {
              content: {
                id: "9",
                title: "T",
                _links: { webui: "/spaces/DOCS/pages/9/T" },
              },
            },
          ],
        }),
        "confluence_search",
        { cql: "type=page" }
      )
    );
    expect(out[0].link).toBe("https://example.atlassian.net/wiki/spaces/DOCS/pages/9/T");
  });

  /** l-066 self-check: a result with neither url nor content webui still
   * yields null. This is the exact symptom that shipped, and asserting it
   * here means the two tests above cannot pass by accident on any input. */
  it("still yields null when the response carries no link at all", async () => {
    const out = parse(
      await handleConfluence(fakeClient(OLD_ASSUMED_RESPONSE), "confluence_search", {
        cql: "type=page",
      })
    );
    expect(out[0].link).toBeNull();
    expect(out[0].id).toBe("131174");
  });
});
