import type { TestCase } from "../types";
import { jiraProjectKey } from "../jira-project";
import { resultJson } from "../result-json";

type Receipt = {
  attachment?: { id?: string | number | null; filename?: string | null; size?: number | null };
  sent?: { bytes?: number; sha256?: string };
  issue?: { key?: string | null };
  size_mismatch?: boolean;
};

/**
 * JR8 (Jira scenario): an email's original file is attached to an issue,
 * and the receipt is true.
 *
 * `jira_add_attachment` takes a FILE REFERENCE, not a file. The gateway
 * reads the message from Gmail as the reader account, holds the bytes in
 * memory and hands them to the Jira plugin, which uploads them as the
 * atlassian account. It is the only call in the suite that uses two
 * connectors and two accounts in one tool call, and the only evidence the
 * caller gets is a receipt.
 *
 * SO THE RECEIPT IS CHECKED FIELD BY FIELD, each under its own name. A
 * receipt for a different issue is the failure that matters most: the file
 * is somebody's mail, and "it was attached" is true of the wrong issue too.
 * The byte count and the hash say what was sent, and Jira's own size is
 * compared with the byte count rather than trusting the absence of the
 * mismatch flag.
 *
 * THEN JIRA IS ASKED, because the claim is what Jira holds and not what the
 * tool said. `jira_get_issue` reads the issue from a different endpoint
 * than the upload answered from, and it must list an attachment with the
 * receipt's id and the same size. A tool that wrote a well-formed receipt
 * and uploaded nothing would pass every check above this one.
 *
 * A failing result reads as one of: the tool answered an error, the receipt
 * names another issue, the sizes disagree, or the issue lists no such
 * attachment.
 *
 * NOTHING ABOUT THE MESSAGE IS WRITTEN DOWN. The filename is built from the
 * message's subject, so the evidence carries a byte count and whether the
 * sizes agree, and never the filename, the hash, the issue key or an
 * address.
 *
 * WHAT IT DOES NOT PROVE: that the bytes Jira stored are the bytes Gmail
 * holds. Nothing here downloads the attachment and hashes it, so a
 * corruption that kept the length would pass.
 *
 * The delete is the cleanup, and deleting an issue removes its attachments.
 * C11 already proves a delete leaves the rest of the board alone, so that
 * comparison is not repeated here.
 */
export const jr8JiraAttachEmail: TestCase = {
  id: "JR8",
  title: "an email is attached to an issue as its original file, and the issue lists it",
  covers: [
    "atlassian-mcp__jira_create_issue",
    "atlassian-mcp__jira_add_attachment",
    "atlassian-mcp__jira_get_issue",
    "atlassian-mcp__jira_delete_issue",
  ],
  accounts: ["reader", "atlassian"],
  fixtures: ["jiraProject", "smokeMessage"],
  timeoutMs: 180_000,
  run: async (ctx) => {
    const project = jiraProjectKey(ctx);

    /* PINNED, NOT SEARCHED. The file is the standing smoke message the
     * fixture names, the way the attachment case names its message. A
     * search for the prefix came back empty whenever the runner's own mail
     * had been trashed, which is most of the time, and a step that fails
     * for want of a message proves nothing about attaching one. */
    const message_id = ctx.fixture("smokeMessage");
    ctx.evidence("the source is the standing smoke message");

    const created = await ctx.call(
      "atlassian-mcp__jira_create_issue",
      {
        project_key: project,
        summary: `smoke-fixture JR8 delete-me ${ctx.stamp}`,
        issue_type: "Task",
        additional_fields: { labels: ["smoke-fixture"] },
      },
      { as: "atlassian" }
    );
    const issue_key = resultJson<{ key?: string }>("jira_create_issue", created).key;
    if (!issue_key) throw new Error("jira_create_issue returned no key, so there is nothing to attach to or delete");

    /* REGISTERED BEFORE THE ATTACH, so a throw anywhere below still removes
     * the issue, and with it whatever was attached. */
    let deleted = false;
    ctx.defer("delete the throwaway issue and its attachment", async () => {
      if (deleted) return;
      const res = await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key }, { as: "atlassian" });
      if (res.isError) {
        ctx.evidence("RESIDUE: the throwaway issue could not be deleted, and it may carry a copy of a message");
        throw new Error("the throwaway issue could NOT be deleted and must be removed in the Jira UI");
      }
    });

    /* THE REFERENCE NAMES THE READER'S MAILBOX. The call runs as the
     * atlassian account, which is the one the runner injects; the account
     * inside `file` is a different field, and says whose Gmail holds the
     * message. Left out, the gateway would read the default Google account,
     * which is not one this suite may touch. */
    const receipt = resultJson<Receipt>(
      "jira_add_attachment",
      await ctx.call(
        "atlassian-mcp__jira_add_attachment",
        { issue_key, file: { type: "gmail_message", message_id, account: ctx.address("reader") } },
        { as: "atlassian" }
      )
    );

    if (receipt.issue?.key !== issue_key) {
      throw new Error("the receipt names a different issue than the one asked for, so the file may be on the wrong issue");
    }
    const bytes = receipt.sent?.bytes;
    if (typeof bytes !== "number" || !Number.isInteger(bytes) || bytes <= 0) {
      throw new Error("the receipt does not say how many bytes were sent as a positive whole number");
    }
    if (typeof receipt.sent?.sha256 !== "string" || !/^[0-9a-f]{64}$/.test(receipt.sent.sha256)) {
      throw new Error("the receipt's sha256 is not 64 lowercase hex characters, so it cannot be checked against the file");
    }
    const sizesAgree = receipt.attachment?.size === bytes;
    ctx.evidence(`${bytes} bytes were sent, and the size Jira reported ${sizesAgree ? "agrees" : "does not agree"}`);
    if (!sizesAgree) {
      throw new Error("the size Jira reported for the attachment is not the number of bytes sent");
    }
    if (receipt.size_mismatch !== undefined) {
      throw new Error("the receipt carries size_mismatch although its two sizes are equal, so the flag is not derived from them");
    }
    const filename = receipt.attachment?.filename;
    if (typeof filename !== "string" || !filename.endsWith(".eml")) {
      throw new Error("the attachment is not named as an .eml file, so it is not the message's original");
    }
    const attachmentId = receipt.attachment?.id;
    if (attachmentId === undefined || attachmentId === null || String(attachmentId) === "") {
      throw new Error("the receipt carries no attachment id, so the attachment cannot be looked for on the issue");
    }

    // THE POSITIVE CONTROL: what Jira holds, read from the issue itself.
    const issue = resultJson<{ attachments?: { id?: string | number; size?: number }[] }>(
      "jira_get_issue",
      await ctx.call("atlassian-mcp__jira_get_issue", { issue_key }, { as: "atlassian" })
    );
    const listed = issue.attachments ?? [];
    const held = listed.find((a) => a.id !== undefined && String(a.id) === String(attachmentId));
    if (!held) {
      throw new Error(
        `the issue lists ${listed.length} attachment(s) and none has the receipt's id, so the receipt describes an upload Jira does not hold`
      );
    }
    if (held.size !== bytes) {
      throw new Error("the issue lists the attachment at a different size than the bytes sent");
    }
    ctx.evidence(`the issue lists ${listed.length} attachment(s), one with the receipt's id at the same size`);

    const gone = await ctx.call("atlassian-mcp__jira_delete_issue", { issue_key }, { as: "atlassian" });
    if (gone.isError) throw new Error("the throwaway issue could not be deleted after the attachment was checked");
    deleted = true;
  },
};
