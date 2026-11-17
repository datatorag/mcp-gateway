import type { CaseContext, ToolResult } from "./types";
import { resultText } from "./result-json";

/**
 * The check NF1 to NF7 share (SCRUM-495): a read of an id Google cannot find
 * was refused, opens by naming what was not found and its id, names the
 * account that was asked, points at the tool that finds it again and at
 * list_connected_accounts, and keeps Google's own code after the sentence.
 */
export function expectNotFoundAnswer(
  ctx: CaseContext,
  result: ToolResult,
  expected: { opens: string; next: string }
): void {
  const text = resultText(result).trim();
  const account = ctx.address("sender").toLowerCase();
  ctx.evidence(
    `isError=${result.isError === true}; opens as expected: ${text.startsWith(expected.opens)}; names the account: ${text.toLowerCase().includes(account)}`
  );
  if (!result.isError) throw new Error("reading something that does not exist reported success");
  if (!text.startsWith(expected.opens)) throw new Error("the answer does not open by naming what was not found and its id");
  if (!text.toLowerCase().includes(account)) throw new Error("the answer does not name the account that was asked");
  for (const next of [expected.next, "list_connected_accounts"]) {
    if (!text.includes(next)) throw new Error(`the answer does not point at ${next}`);
  }
  if (!/\(Google: (404|400) /.test(text)) throw new Error("Google's own code is not kept after the sentence");
}
