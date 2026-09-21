import type { TestCase } from "../types";

/**
 * G1 (tier 1): a bad argument produces an error that names the cause.
 *
 * A guard whose failure MISDESCRIBES the problem is worse than one that
 * throws. Salvaged bad input once turned a one-character configuration typo
 * into "every tool is undiscovered", pointing at three subsystems that were
 * all fine.
 */
export const g1ErrorShape: TestCase = {
  id: "G1",
  title: "a read against a spreadsheet that does not exist names the cause",
  tier: 1,
  covers: ["gws-mcp__sheets_read"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call(
      "gws-mcp__sheets_read",
      { spreadsheet_id: `no-such-sheet-${ctx.stamp}`, range: "A1:B2" },
      { as: "sender" }
    );
    const text = result.content.map((c) => c.text ?? "").join("").trim();
    ctx.evidence(`answered isError=${result.isError === true}, ${text.length} characters`);

    if (!result.isError) throw new Error("a read of a spreadsheet that does not exist reported success");
    if (text === "") throw new Error("the error carries no text at all, so a caller learns nothing");
    if (/^null$|^\{\}$|^\[\]$/.test(text)) {
      throw new Error(`the error is an empty shape (${text}), which a caller cannot act on`);
    }
  },
};
