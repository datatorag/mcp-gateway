import type { TestCase } from "../types";
import { jiraProjectKey } from "../jira-project";
import { resultText } from "../result-json";
import { firstMessageId, SOURCE_MESSAGE_QUERIES } from "../source-message";

/**
 * JR9 (Jira scenario): attaching to an issue that does not exist sends
 * nothing to Jira, and says so.
 *
 * The file is somebody's mail, so the dangerous outcomes of a wrong key are
 * the quiet ones: an upload that lands on a neighbouring issue, or an
 * answer that reads like success. The plugin reads the issue BEFORE it
 * uploads, and refuses with a sentence saying nothing was sent. That check
 * is the product behaviour, so it gets a step; a suite that only attached
 * to real issues would let it be removed as dead code.
 *
 * THE KEY IS WELL FORMED ON PURPOSE. A malformed key is refused by a shape
 * check that never asks Jira anything, which is a different guard (JR7
 * covers its sibling on the delete). This one has the configured project
 * and a number no board reaches, so it passes the shape check and the
 * refusal has to come from Jira not finding the issue.
 *
 * A REFUSAL ARRIVES AS `isError`, NOT AS A THROW, and the text is checked
 * as well as the flag. The gateway can refuse this call too, before the
 * Jira plugin is asked anything: no connected account, a message it could
 * not read. Those are also `isError`, and their sentences say nothing was
 * UPLOADED, so only the plugin's own words, nothing was sent, show that the
 * issue check is what stopped it. A receipt here is the failure.
 *
 * WHAT IT DOES NOT PROVE: that Gmail was not read. The gateway fetches the
 * message's bytes before the Jira plugin checks the issue, so on this path
 * the message IS read and its bytes do reach the plugin's process. The
 * claim is only that they went no further: nothing was uploaded to Jira.
 * It also cannot prove no issue changed, since there is no issue to read
 * back.
 */
export const jr9JiraAttachMissingIssue: TestCase = {
  id: "JR9",
  title: "attaching to an issue that does not exist is refused, and nothing is sent to Jira",
  covers: ["gws-mcp__gmail_search", "atlassian-mcp__jira_add_attachment"],
  accounts: ["reader", "atlassian"],
  fixtures: ["jiraProject"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    /* THE PROJECT COMES FROM THE FIXTURE and the number is one no board
     * reaches, so the key is real in shape and absent in fact. */
    const issue_key = `${jiraProjectKey(ctx)}-999999999`;

    // A REAL MESSAGE, found the way JR8 finds it. With a made-up id the
    // gateway would fail on the Gmail leg and the issue check would never run.
    let message_id: string | undefined;
    for (const query of SOURCE_MESSAGE_QUERIES) {
      message_id = firstMessageId(
        await ctx.call("gws-mcp__gmail_search", { query, max_results: 10 }, { as: "reader" })
      );
      if (message_id) break;
    }
    if (!message_id) {
      throw new Error(
        "the reader mailbox has no smoke message under 1 MB to offer, so this step cannot run; it needs a standing smoke message"
      );
    }

    const result = await ctx.call(
      "atlassian-mcp__jira_add_attachment",
      { issue_key, file: { type: "gmail_message", message_id, account: ctx.address("reader") } },
      { as: "atlassian" }
    );
    if (!result.isError) {
      throw new Error(
        "attaching to an issue that does not exist was not refused, so a file was sent somewhere or the answer claims it was"
      );
    }

    const said = resultText(result);
    if (/no connected account found|is not connected|needs a connected account/i.test(said)) {
      throw new Error(
        "the gateway refused before dispatch because an account is not connected, so the issue check was never reached"
      );
    }
    if (/not a jira issue key/i.test(said)) {
      throw new Error(
        "the key was refused for its shape, so Jira was never asked about the issue and this step proved a different guard"
      );
    }
    if (!/nothing was (sent|attached)/i.test(said)) {
      throw new Error(
        /nothing was (read|uploaded)/i.test(said)
          ? "the gateway refused while moving the file, before the Jira plugin was asked, so the issue check was never reached"
          : "the call was refused without saying that nothing was sent, so a caller cannot tell whether the file went anywhere"
      );
    }
    ctx.evidence(
      `the refusal says nothing was sent, and ${/could not read issue/i.test(said) ? "names the issue read as the reason" : "gives a reason other than the issue read"}`
    );
  },
};
