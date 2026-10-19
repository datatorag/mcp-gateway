import type { TestCase } from "../types";
import { jiraProjectKey } from "../jira-project";
import { resultJson } from "../result-json";

type Receipt = {
  attachment?: { id?: string | number | null; filename?: string | null; size?: number | null };
  sent?: { bytes?: number; sha256?: string };
  issue?: { key?: string | null };
};

/**
 * JR13 (Jira scenario, SCRUM-428): the fixture Doc, exported as a PDF through
 * a `drive_export` reference, is attached to a throwaway issue, and Jira
 * holds what was sent.
 *
 * The call runs as the atlassian account and the reference's `account`
 * names the Google account whose Drive holds the Doc. The proof is Jira's
 * own: the attachment the issue lists has the receipt's id and the byte count
 * that was sent, under a name ending .pdf. Deleting the issue removes it.
 */
export const jr13JiraAttachDocPdf: TestCase = {
  id: "JR13",
  title: "a Doc exported as a PDF is attached to an issue, and the issue lists it",
  covers: ["atlassian-mcp__jira_add_attachment", "atlassian-mcp__jira_create_issue", "atlassian-mcp__jira_get_issue", "atlassian-mcp__jira_delete_issue"],
  accounts: ["atlassian", "sender"],
  fixtures: ["jiraProject", "doc"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const issue_key = resultJson<{ key?: string }>(
      "jira_create_issue",
      await ctx.call(
        "atlassian-mcp__jira_create_issue",
        { project_key: jiraProjectKey(ctx), summary: `smoke-fixture JR13 delete-me ${ctx.stamp}`, issue_type: "Task", additional_fields: { labels: ["smoke-fixture"] } },
        { as: "atlassian" }
      )
    ).key;
    if (!issue_key) throw new Error("jira_create_issue returned no key, so there is nothing to attach to");
    ctx.defer("delete the throwaway issue and its attachment", async () => {
      const res = await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key }, { as: "atlassian" });
      if (res.isError) {
        ctx.evidence("RESIDUE: the throwaway issue could not be deleted, and it carries a copy of the fixture Doc");
        throw new Error("the throwaway issue could NOT be deleted and must be removed in the Jira UI");
      }
    });

    const receipt = resultJson<Receipt>(
      "jira_add_attachment",
      await ctx.call(
        "atlassian-mcp__jira_add_attachment",
        { issue_key, file: { type: "drive_export", file_id: ctx.fixture("doc"), format: "pdf", account: ctx.address("sender") } },
        { as: "atlassian" }
      )
    );
    const bytes = receipt.sent?.bytes;
    if (receipt.issue?.key !== issue_key) throw new Error("the receipt names a different issue than the one asked for");
    if (typeof bytes !== "number" || bytes <= 0) throw new Error("the receipt does not say how many bytes were sent");
    if (!(receipt.attachment?.filename ?? "").endsWith(".pdf")) throw new Error("the attachment is not named as a PDF");
    if (receipt.attachment?.size !== bytes) throw new Error("the size Jira reported is not the number of bytes sent");

    const issue = resultJson<{ attachments?: { id?: string | number; size?: number }[] }>(
      "jira_get_issue",
      await ctx.call("atlassian-mcp__jira_get_issue", { issue_key }, { as: "atlassian" })
    );
    const held = (issue.attachments ?? []).find((a) => String(a.id) === String(receipt.attachment?.id));
    ctx.evidence(`${bytes} bytes sent; the issue lists the attachment: ${held !== undefined}, at ${held?.size} bytes`);
    if (!held || held.size !== bytes) throw new Error("the issue does not list the attachment at the size that was sent");
  },
};
