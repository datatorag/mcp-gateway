import type { TestCase } from "../types";
import { firstArray, resultJson } from "../result-json";

/**
 * C11 (smoke row C11): the most destructive verb in the connector
 * deletes what it was asked to and NOTHING ELSE.
 *
 * It sits in the sheet's read section and is not a read: it creates a
 * throwaway issue and deletes it. The test IS the cleanup, and if the delete
 * fails the throwaway has to be removed by hand, which the failure says.
 *
 * THE BASELINE MUST BE THE WHOLE BOARD, and that sentence is the case.
 * `jira_search` caps a page at 100 regardless of `max_results` and does not
 * say it clamped: a request for 150 comes back with 100, `isLast` false and
 * a page token. A single-call version would compare the first hundred
 * before against the first hundred after, PASS, and write "whole board" in
 * the log. Worse, deletion risk concentrates in RECENT keys, which are
 * exactly the ones that fall off the end of page one as the board grows, so
 * the blindness lands precisely where it matters. Read the value back;
 * never assume the number you asked for is the number you got.
 */
export const c11JiraRoundTrip: TestCase = {
  id: "C11",
  title: "a created issue is deleted and it is the only thing that changed",
  covers: [
    "atlassian-mcp__jira_search",
    "atlassian-mcp__jira_create_issue",
    "atlassian-mcp__jira_delete_issue",
    "atlassian-mcp__jira_get_issue",
  ],
  accounts: ["atlassian"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    /** Every key on the board, paginated to exhaustion. */
    const wholeBoard = async (): Promise<Set<string>> => {
      const keys = new Set<string>();
      let token: string | undefined;
      let pages = 0;
      for (;;) {
        const args: Record<string, unknown> = { jql: "project = SCRUM ORDER BY created DESC", max_results: 100 };
        if (token) args.next_page_token = token;
        const res = await ctx.call("atlassian-mcp__jira_search", args, { as: "atlassian" });
        const body = resultJson<{ isLast?: boolean; nextPageToken?: string; next_page_token?: string }>(
          "jira_search",
          res
        );
        for (const issue of firstArray(body) ?? []) {
          const key = (issue as { key?: string }).key;
          if (key) keys.add(key);
        }
        pages += 1;
        token = body.nextPageToken ?? body.next_page_token;
        // THE STOP CONDITION IS `isLast`, not an empty page and not a page
        // count: a short page is not the last page.
        if (body.isLast === true || !token) {
          if (body.isLast !== true && token) continue;
          ctx.evidence(`baseline read ${keys.size} issues over ${pages} page(s), ending on isLast`);
          return keys;
        }
        if (pages > 50) throw new Error("the board did not end after 50 pages; refusing to loop");
      }
    };

    const before = await wholeBoard();
    if (before.size === 0) throw new Error("the baseline is empty, so nothing below can be concluded");

    const created = await ctx.call(
      "atlassian-mcp__jira_create_issue",
      {
        project_key: "SCRUM",
        summary: `smoke-fixture C11 delete-me ${ctx.stamp}`,
        issue_type: "Task",
        additional_fields: { labels: ["smoke-fixture"] },
      },
      { as: "atlassian" }
    );
    const key = resultJson<{ key?: string }>("jira_create_issue", created).key;
    if (!key) throw new Error("jira_create_issue returned no key, so nothing can be deleted");

    let deleted = false;
    ctx.defer("delete the throwaway issue", async () => {
      if (deleted) return;
      const res = await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key: key }, { as: "atlassian" });
      if (res.isError) {
        // Named, because nothing else can remove it: this one needs hands.
        throw new Error(`the throwaway issue ${key} could NOT be deleted and must be removed in the Jira UI`);
      }
    });

    await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key: key }, { as: "atlassian" });
    deleted = true;

    const after = await ctx.call("atlassian-mcp__jira_get_issue", { issue_key: key }, { as: "atlassian" });
    if (!after.isError) throw new Error(`${key} still reads after a delete that reported success`);
    ctx.evidence(`reading ${key} after the delete fails, as it should`);

    const now = await wholeBoard();
    const vanished = [...before].filter((k) => !now.has(k));
    const appeared = [...now].filter((k) => !before.has(k));
    ctx.evidence(`after: ${now.size} issues, ${vanished.length} gone, ${appeared.length} new`);

    // The created key is never in `before`, so the ONLY honest assertion is
    // that nothing from the baseline disappeared.
    if (vanished.length > 0) {
      throw new Error(`the delete removed ${vanished.length} issue(s) that existed before this case ran: ${vanished.join(", ")}`);
    }
    if (now.has(key)) throw new Error(`${key} is still on the board after its delete`);
  },
};
