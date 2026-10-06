import type { TestCase } from "../types";
import { resultText } from "../result-json";

/**
 * G2 (Gateway scenario): a call the tool cannot take is refused by the
 * GATEWAY, naming the argument, before any plugin is asked.
 *
 * A regression guard with a proven failure: a client passed `body` where
 * the tool wanted `comment`, five times, and got the provider's opaque 400
 * back each time, because the gateway forwarded whatever it was given. The
 * gateway serves every tool's schema and can say what is wrong by name.
 *
 * TWO CALLS, TWO GUARDS. The first omits a required argument; the second
 * adds one the tool does not declare. Each must come back as an error whose
 * text uses the gateway's own words ("required", "unknown"), which the
 * provider's errors do not: a provider 400 for a missing key says "Issue
 * does not exist" or nothing at all, never "missing required argument".
 * That wording is the evidence the refusal happened here.
 *
 * A read tool, so a refusal that failed to fire costs one harmless read.
 * The arguments below are WRONG ON PURPOSE and are named as such in the
 * static argument check, so the check keeps catching mistakes elsewhere.
 */
export const g2ArgumentRefusal: TestCase = {
  id: "G2",
  title: "a missing required argument and an unknown argument are refused by name before any plugin is asked",
  covers: ["atlassian-mcp__jira_get_issue"],
  accounts: ["atlassian"],
  run: async (ctx) => {
    const missing = await ctx.call("atlassian-mcp__jira_get_issue", {}, { as: "atlassian" });
    const missingText = resultText(missing).trim();
    ctx.evidence(`empty call: isError=${missing.isError === true}, ${missingText.length} characters`);
    if (!missing.isError) throw new Error("a call with no arguments was answered as if it were valid");
    if (!/missing required argument/i.test(missingText) || !/issue_key/.test(missingText)) {
      throw new Error("the refusal does not name the missing argument in the gateway's words, so it came from somewhere else or not at all");
    }

    const unknown = await ctx.call(
      "atlassian-mcp__jira_get_issue",
      { issue_key: `NOPE-${ctx.stamp.replace(/\D/g, "").slice(0, 6) || "1"}`, issue_id: "not-a-parameter" },
      { as: "atlassian" }
    );
    const unknownText = resultText(unknown).trim();
    ctx.evidence(`unknown argument: isError=${unknown.isError === true}, ${unknownText.length} characters`);
    if (!unknown.isError) throw new Error("a call with an argument the tool does not take was answered as if it were valid");
    if (!/unknown argument/i.test(unknownText) || !/issue_id/.test(unknownText)) {
      throw new Error("the refusal does not name the unknown argument in the gateway's words, so it came from somewhere else or not at all");
    }
    if (/does not exist/i.test(unknownText)) {
      throw new Error("the answer reads as the provider's, so the plugin was asked after all");
    }
  },
};
