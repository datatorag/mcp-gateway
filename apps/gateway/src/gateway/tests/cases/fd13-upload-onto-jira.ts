import type { TestCase } from "../types";
import { jiraProjectKey } from "../jira-project";
import { resultJson } from "../result-json";
import { contentFile } from "../content-file";
import { uploadThroughLink } from "../upload-link";

type Receipt = {
  attachment?: { id?: string | number | null; size?: number | null };
  sent?: { bytes?: number; sha256?: string };
  issue?: { key?: string | null };
};

/**
 * FD13 (Jira scenario, SCRUM-437): a file sent through an upload link is
 * attached to a throwaway issue by its upload reference, and the issue
 * lists it at the size sent. Deleting the issue removes it.
 */
export const fd13UploadOntoJira: TestCase = {
  id: "FD13",
  title: "a file sent through an upload link is attached to an issue as the bytes that were sent",
  covers: ["file_upload_link", "atlassian-mcp__jira_add_attachment", "atlassian-mcp__jira_create_issue", "atlassian-mcp__jira_get_issue", "atlassian-mcp__jira_delete_issue"],
  accounts: ["atlassian"],
  fixtures: ["jiraProject"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const issue_key = resultJson<{ key?: string }>(
      "jira_create_issue",
      await ctx.call(
        "atlassian-mcp__jira_create_issue",
        { project_key: jiraProjectKey(ctx), summary: `smoke-fixture FD13 delete-me ${ctx.stamp}`, issue_type: "Task", additional_fields: { labels: ["smoke-fixture"] } },
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
    const { upload_id } = await uploadThroughLink(ctx, await ctx.call("file_upload_link", {}), { ...file, name: `fd13-${ctx.stamp}.png` });
    const receipt = resultJson<Receipt>(
      "jira_add_attachment",
      await ctx.call("atlassian-mcp__jira_add_attachment", { issue_key, file: { type: "upload", upload_id } }, { as: "atlassian" })
    );
    if (receipt.sent?.sha256 !== file.sha256) throw new Error("what reached Jira is not the file the case uploaded");
    const issue = resultJson<{ attachments?: { id?: string | number; size?: number }[] }>(
      "jira_get_issue",
      await ctx.call("atlassian-mcp__jira_get_issue", { issue_key }, { as: "atlassian" })
    );
    const held = (issue.attachments ?? []).find((a) => String(a.id) === String(receipt.attachment?.id));
    ctx.evidence(`the issue lists the attachment at ${held?.size} bytes of ${file.bytes.length}`);
    if (!held || held.size !== file.bytes.length) throw new Error("the issue does not list the attachment at the size that was sent");
  },
};
