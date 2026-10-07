import type { TestCase } from "../types";
import { jiraProjectKey } from "../jira-project";
import { resultJson } from "../result-json";

type Attachment = { partId?: string; filename?: string; mimeType?: string; size?: number };
type Receipt = {
  attachment?: { id?: string | number | null; filename?: string | null; size?: number | null };
  sent?: { bytes?: number; sha256?: string };
  issue?: { key?: string | null };
  size_mismatch?: boolean;
};

/**
 * JR10 (Jira scenario): one attachment of an email is attached to an issue
 * by its PART id, and the receipt is true.
 *
 * The sibling of JR8 for the second reference type (SCRUM-395). JR8 moves a
 * message as its original file; this moves one file the message carries,
 * named by `part_id`. The part id comes from `gmail_read`, which is the
 * only honest source: Gmail issues a new attachment id on every read of a
 * message, so a case that pinned one would fail on the next read for a
 * reason that has nothing to do with the crossing.
 *
 * THREE SIZES MUST AGREE, each from a different place: what Gmail declared
 * for the part, what the gateway says it sent, and what Jira says it holds.
 * The first is the control the other two lack: a crossing that sent the
 * wrong part, or the message instead of the part, would still produce a
 * receipt whose two sizes agree with each other.
 *
 * THEN JIRA IS ASKED, as in JR8, because the claim is what Jira holds and
 * not what the tool said.
 *
 * THE FIXTURE MUST CARRY AN ATTACHMENT. The standing message is the suite's
 * own, sent between its two addresses, and this case fails rather than
 * skips when it has none: a fixture that cannot serve its case is a fact
 * about the fixture, and a skip would hide it.
 *
 * NOTHING ABOUT THE FILE IS WRITTEN DOWN. The evidence carries byte counts,
 * a part id and whether the sizes agree; never the file's name, the hash,
 * the issue key or an address.
 *
 * WHAT IT DOES NOT PROVE: that the bytes Jira stored are the bytes Gmail
 * holds, for the same reason as JR8.
 */
export const jr10JiraAttachEmailAttachment: TestCase = {
  id: "JR10",
  title: "an email's attachment is attached to an issue by its part id, and the sizes agree",
  covers: [
    "gws-mcp__gmail_read",
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
    const message_id = ctx.fixture("smokeMessage");

    const read = resultJson<{ attachments?: Attachment[] }>(
      "gmail_read",
      await ctx.call("gws-mcp__gmail_read", { message_id, text_only: true, max_body_chars: 1 }, { as: "reader" })
    );
    const part = (read.attachments ?? []).find(
      (a) => typeof a.partId === "string" && a.partId !== "" && typeof a.size === "number" && a.size > 0
    );
    if (!part) {
      throw new Error(
        "the standing fixture message carries no attachment with a part id and a size, so this step cannot run; it needs one attached"
      );
    }
    const part_id = part.partId as string;
    const declared = part.size as number;
    ctx.evidence(`the fixture message lists an attachment at part ${part_id}, ${declared} bytes by Gmail's account`);

    const created = await ctx.call(
      "atlassian-mcp__jira_create_issue",
      {
        project_key: project,
        summary: `smoke-fixture JR10 delete-me ${ctx.stamp}`,
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
        ctx.evidence("RESIDUE: the throwaway issue could not be deleted, and it may carry a copy of a file");
        throw new Error("the throwaway issue could NOT be deleted and must be removed in the Jira UI");
      }
    });

    /* The reference names the reader's mailbox, as in JR8: the call runs as
     * the atlassian account and `account` inside `file` says whose Gmail
     * holds the message. */
    const receipt = resultJson<Receipt>(
      "jira_add_attachment",
      await ctx.call(
        "atlassian-mcp__jira_add_attachment",
        { issue_key, file: { type: "gmail_attachment", message_id, part_id, account: ctx.address("reader") } },
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
    ctx.evidence(
      `${bytes} bytes were sent (Gmail declared ${declared}), and the size Jira reported ${sizesAgree ? "agrees" : "does not agree"}`
    );
    if (bytes !== declared) {
      throw new Error("the bytes sent are not the size Gmail declared for the part, so the wrong thing may have been moved");
    }
    if (!sizesAgree) {
      throw new Error("the size Jira reported for the attachment is not the number of bytes sent");
    }
    if (receipt.size_mismatch !== undefined) {
      throw new Error("the receipt carries size_mismatch although its two sizes are equal, so the flag is not derived from them");
    }
    const filename = receipt.attachment?.filename;
    if (typeof filename !== "string" || filename === "") {
      throw new Error("the attachment has no name on the receipt, so it was not stored under the sender's file name");
    }
    if (filename.endsWith(".eml")) {
      throw new Error("the attachment is named as an .eml file, so the message was moved instead of its attachment");
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
