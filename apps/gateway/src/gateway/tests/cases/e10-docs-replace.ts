import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";

/**
 * E10 (smoke row E10): the NESTED `replaceAllText` shape works, and the
 * wrong shape is still refused.
 *
 * Guards SCRUM-175, where a caller put `matchCase` at the top level because
 * our own description never showed the request shape. Both halves matter:
 * proving the right shape works is the feature, and proving the wrong shape
 * is REFUSED is what stops the next person guessing. A refusal that says
 * only "invalid request" recreates the original bug with extra steps.
 *
 * The refusal check below is weaker than "names the field", in two ways.
 * It matches the stem `propert`, so a refusal saying only "property" or
 * "properties" passes without naming anything. And two of its three
 * alternatives, `matchCase` and `containsText`, are literals THE REQUEST
 * ITSELF SUPPLIED, so an error that merely echoes the bad request back
 * satisfies it while naming nothing the caller did not already type. That
 * second one is the shape to design against if this is ever tightened.
 *
 * It is left as it is, but the reason is narrower than "we do not know
 * what the API says". A real sample IS on record, in this repo, in the
 * SCRUM-175 blog post:
 *
 *     requests[0].replaceAllText.matchCase: Unknown property.
 *     Valid properties: ["tabsCriteria", "replaceText", "containsText"]
 *
 * That suggests the echo-proof assertion this check is missing: require
 * something the REQUEST DID NOT CONTAIN, such as `Unknown property`,
 * `Valid properties`, or `tabsCriteria`. An error that parrots the bad
 * request back cannot satisfy any of those.
 *
 * What stops that landing here is that one sample, quoted in prose, is not
 * the same as an observed current response: Google can change the wording,
 * and this suite has never run E10 against the live API. Tightening on a
 * sample nobody re-verified would turn a passing case red for a reason
 * unrelated to the product, and a case that goes red for the wrong reason
 * gets muted, which costs SCRUM-175's guard entirely. Confirm the text on
 * a live run, then narrow to it.
 *
 * It works on a doc it creates and deletes, never on a fixture other cases
 * read: this one rewrites text, and a shared fixture would end the run
 * different from how it started.
 */
export const e10DocsReplace: TestCase = {
  id: "E10",
  title: "replaceAllText works nested and the flat shape is refused",
  covers: ["gws-mcp__docs_create", "gws-mcp__docs_write", "gws-mcp__docs_batch_update", "gws-mcp__docs_get", "gws-mcp__docs_delete"],
  accounts: ["sender"],
  run: async (ctx) => {
    const before = `SMOKE-E10-BEFORE-${ctx.stamp}`;
    const after = `SMOKE-E10-AFTER-${ctx.stamp}`;

    const created = await ctx.call(
      "gws-mcp__docs_create",
      { title: `[smoke] replaceAllText ${ctx.stamp}` },
      { as: "sender" }
    );
    const document_id = resultJson<{ documentId?: string }>("docs_create", created).documentId;
    if (!document_id) throw new Error("docs_create returned no document id");
    ctx.defer("delete the scratch doc", async () => {
      await ctx.call("gws-mcp__docs_delete", { document_id }, { as: "sender" });
    });

    await ctx.call("gws-mcp__docs_write", { document_id, text: before }, { as: "sender" });

    // THE CORRECT SHAPE: matchCase nested inside containsText, which is
    // where the API wants it and where our description now says it goes.
    const replaced = await ctx.call(
      "gws-mcp__docs_batch_update",
      {
        document_id,
        requests: [
          { replaceAllText: { containsText: { text: before, matchCase: true }, replaceText: after } },
        ],
      },
      { as: "sender" }
    );
    if (replaced.isError) {
      throw new Error(`the documented replaceAllText shape was rejected: ${resultText(replaced).slice(0, 200)}`);
    }

    const read = resultJson<{ text?: string }>(
      "docs_get",
      await ctx.call("gws-mcp__docs_get", { document_id, mode: "text" }, { as: "sender" })
    ).text ?? "";
    ctx.evidence(`after the replacement the doc holds the new marker: ${read.includes(after)}`);
    if (!read.includes(after)) throw new Error("the replacement reported success and did not happen");
    if (read.includes(before)) throw new Error("the original text is still there after the replacement");

    // THE WRONG SHAPE, matchCase hoisted to the top level. It must be
    // refused; the check on the refusal text below is weaker than that,
    // and the docblock says how.
    const wrong = await ctx.call(
      "gws-mcp__docs_batch_update",
      {
        document_id,
        requests: [
          { replaceAllText: { containsText: { text: after }, matchCase: true, replaceText: "nope" } },
        ],
      },
      { as: "sender" }
    );
    const text = resultText(wrong).trim();
    ctx.evidence(`the flat shape answered isError=${wrong.isError === true}, ${text.length} characters`);

    if (!wrong.isError) {
      throw new Error("the flat matchCase shape was ACCEPTED, so the shape that caused the original bug now silently works differently");
    }
    if (!/matchCase|containsText|propert/i.test(text)) {
      throw new Error("the refusal names neither the field nor the valid properties, so a caller guesses again");
    }
  },
};
