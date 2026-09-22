import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Attachment = { id?: string | number; filename?: string; size?: number; mimeType?: string; content?: string };

/**
 * JR6 (Jira scenario): the attachment endpoint agrees with the issue.
 *
 * `jira_get_attachment` answers with `{id, filename, size, mimeType,
 * content}`, and `jira_get_issue` projects each of an issue's attachments
 * into THE SAME FIVE FIELDS. They are not the same call: the issue comes
 * from `/issue/KEY` and the attachment from `/attachment/ID`. Two endpoints
 * agreeing is therefore a real cross-check, and comparing them is stronger
 * than any single-sided assertion this case could make.
 *
 * `content` IS EXCLUDED FROM THE COMPARISON and checked only for presence.
 * It is a download URL rather than the file, so this step proves the
 * metadata agrees, NOT that the bytes can be fetched; and a URL is the kind
 * of value that can carry a token or an expiry, which would make an equality
 * check flap for a reason that has nothing to do with the connector.
 *
 * NO FILENAME IS WRITTEN HERE. The fixture's attachment is named by a person
 * on our tenant and this repo is public, so the case compares the two
 * answers against each other and never against a literal, and reports
 * lengths rather than names.
 */
export const jr6JiraAttachment: TestCase = {
  id: "JR6",
  title: "the attachment endpoint returns the same metadata the issue reports",
  covers: ["atlassian-mcp__jira_get_issue", "atlassian-mcp__jira_get_attachment"],
  accounts: ["atlassian"],
  fixtures: ["jiraAttachmentIssue"],
  run: async (ctx) => {
    const issue_key = ctx.fixture("jiraAttachmentIssue");
    const issue = resultJson<{ attachments?: Attachment[] }>(
      "jira_get_issue",
      await ctx.call("atlassian-mcp__jira_get_issue", { issue_key }, { as: "atlassian" })
    );
    const attachments = issue.attachments ?? [];
    ctx.evidence(`the fixture issue reports ${attachments.length} attachment(s)`);

    // A FIXTURE PROBLEM, named as one: the file is attached by hand.
    const first = attachments.find((a) => a.id);
    if (!first?.id) {
      throw new Error(
        `the fixture issue carries no attachment with an id (${attachments.length} listed), and this step cannot run without one; attach a small file to the fixture issue`
      );
    }

    const direct = resultJson<Attachment>(
      "jira_get_attachment",
      await ctx.call("atlassian-mcp__jira_get_attachment", { attachment_id: first.id }, { as: "atlassian" })
    );

    /* THE SAME ATTACHMENT FIRST, THEN THE SAME TYPE, as two claims. Run 2
     * reported "a different attachment" when it was the same one: Jira types
     * the id as a string inside an issue and as a number from
     * /attachment/ID, and the plugin passes both through, so `"10000"` met
     * `10000`. That is still a disagreement a caller chaining the two tools
     * will trip on, so it stays a failure, under its own name. */
    if (String(direct.id) !== String(first.id)) {
      throw new Error("jira_get_attachment answered about a different attachment than the one asked for");
    }
    if (typeof direct.id !== typeof first.id) {
      throw new Error(
        `the two endpoints name the same attachment but type its id differently (${typeof first.id} in the issue, ${typeof direct.id} from the attachment endpoint)`
      );
    }
    /* PRESENCE BEFORE EQUALITY. `undefined !== undefined` is false, so a
     * comparison alone is satisfied when BOTH sides lack the field. Both
     * sides are projected by the same plugin from the same Jira field
     * names, so one upstream rename would empty them together and this
     * step would pass while proving nothing about either endpoint. */
    const missing = (["filename", "size", "mimeType"] as const).filter(
      (field) => first[field] === undefined || first[field] === null
    );
    if (missing.length > 0) {
      throw new Error(
        `the issue reports its attachment without ${missing.join(", ")}, so there is nothing to compare the attachment endpoint against; the projection or the Jira field names have changed`
      );
    }
    const disagreements = (["filename", "size", "mimeType"] as const).filter(
      (field) => direct[field] !== first[field]
    );
    if (disagreements.length > 0) {
      throw new Error(
        `the attachment endpoint and the issue disagree on ${disagreements.join(", ")} for the same attachment, so one of the two is reading a different record`
      );
    }
    if (typeof direct.content !== "string" || direct.content === "") {
      throw new Error("the attachment carries no content link, so there is no way to fetch the file it describes");
    }
    ctx.evidence(
      `both endpoints agree on id, filename (${String(direct.filename ?? "").length} characters), size and mime type, and a content link is present`
    );
  },
};
