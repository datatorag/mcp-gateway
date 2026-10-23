import type { TestCase } from "../types";
import { jiraProjectKey } from "../jira-project";
import { resultJson } from "../result-json";
import { contentFile } from "../content-file";

type Receipt = {
  attachment?: { id?: string | number | null; filename?: string | null; size?: number | null };
  sent?: { bytes?: number; sha256?: string };
  issue?: { key?: string | null };
};

/**
 * FD7 (Jira scenario, SCRUM-437): a file sent as a `content` reference is
 * attached to a throwaway issue. The receipt's SHA-256 is the hash of the
 * bytes the case sent, and the issue lists the attachment at that size.
 * Deleting the issue removes it.
 */
export const fd7ContentOntoJira: TestCase = {
  id: "FD7",
  title: "a file sent as a content reference is attached to an issue as the bytes that were sent",
  covers: ["atlassian-mcp__jira_add_attachment", "atlassian-mcp__jira_create_issue", "atlassian-mcp__jira_get_issue", "atlassian-mcp__jira_delete_issue"],
  accounts: ["atlassian"],
  fixtures: ["jiraProject"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const issue_key = resultJson<{ key?: string }>(
      "jira_create_issue",
      await ctx.call(
        "atlassian-mcp__jira_create_issue",
        { project_key: jiraProjectKey(ctx), summary: `smoke-fixture FD7 delete-me ${ctx.stamp}`, issue_type: "Task", additional_fields: { labels: ["smoke-fixture"] } },
        { as: "atlassian" }
      )
    ).key;
    if (!issue_key) throw new Error("jira_create_issue returned no key, so there is nothing to attach to");
    ctx.defer("delete the throwaway issue and its attachment", async () => {
      const res = await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key }, { as: "atlassian" });
      if (res.isError) {
        ctx.evidence("RESIDUE: the throwaway issue could not be deleted");
        throw new Error("the throwaway issue could NOT be deleted and must be removed in the Jira UI");
      }
    });

    const file = contentFile();
    const receipt = resultJson<Receipt>(
      "jira_add_attachment",
      await ctx.call(
        "atlassian-mcp__jira_add_attachment",
        { issue_key, file: { type: "content", name: `fd7-${ctx.stamp}.png`, mime_type: "image/png", base64: file.base64 } },
        { as: "atlassian" }
      )
    );
    if (receipt.issue?.key !== issue_key) throw new Error("the receipt names a different issue than the one asked for");
    if (receipt.sent?.sha256 !== file.sha256) throw new Error("what reached Jira is not the file the case sent");
    if (receipt.attachment?.size !== file.bytes.length) throw new Error("the size Jira reported is not the size of the file sent");

    const issue = resultJson<{ attachments?: { id?: string | number; size?: number }[] }>(
      "jira_get_issue",
      await ctx.call("atlassian-mcp__jira_get_issue", { issue_key }, { as: "atlassian" })
    );
    const held = (issue.attachments ?? []).find((a) => String(a.id) === String(receipt.attachment?.id));
    ctx.evidence(`${file.bytes.length} bytes sent, hash is the case's: true; the issue lists the attachment at ${held?.size} bytes`);
    if (!held || held.size !== file.bytes.length) throw new Error("the issue does not list the attachment at the size that was sent");
  },
};
