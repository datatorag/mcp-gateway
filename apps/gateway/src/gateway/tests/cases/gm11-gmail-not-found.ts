import type { TestCase } from "../types";
import { resultText } from "../result-json";

/** An id Gmail reads as an id and has no message for. Gmail ids grow with
 * time, so the smallest one cannot name a real message. Checked against the
 * real test mailboxes before use: Gmail answers it 404. An id outside Gmail's
 * format gets a 400 "Invalid id value" instead, and "fffffffffffffff0", the
 * first choice, turned out to be one, which a replayed 404 body could not
 * show. */
const MISSING_ID = "0000000000000001";
/** A string Gmail does not read as an id at all: its 400, worded too. */
const MALFORMED_ID = "fffffffffffffff0";

/**
 * GM11 (Gmail scenario, SCRUM-493): reading a message Gmail cannot find is
 * refused in words an agent can act on. The answer names the id and the
 * mailbox that was asked, and points at gmail_search and at the connected
 * accounts, before Google's own code. An id Gmail cannot read at all is
 * refused in words too. Read only; nothing is created.
 */
export const gm11GmailNotFound: TestCase = {
  id: "GM11",
  title: "a message id gmail cannot find is refused naming the id and the mailbox",
  covers: ["gws-mcp__gmail_read"],
  accounts: ["reader"],
  run: async (ctx) => {
    const result = await ctx.call("gws-mcp__gmail_read", { message_id: MISSING_ID }, { as: "reader" });
    const text = resultText(result).trim();
    const mailbox = ctx.address("reader").toLowerCase();
    ctx.evidence(
      `isError=${result.isError === true}; names the id: ${text.includes(MISSING_ID)}; names the mailbox: ${text.toLowerCase().includes(mailbox)}`
    );
    if (!result.isError) throw new Error("reading a message that does not exist reported success");
    if (!text.startsWith(`Gmail has no message with the id ${MISSING_ID}`)) {
      throw new Error("the answer does not open by naming the message id that was not found");
    }
    if (!text.toLowerCase().includes(mailbox)) throw new Error("the answer does not name the mailbox that was asked");
    for (const next of ["gmail_search", "list_connected_accounts"]) {
      if (!text.includes(next)) throw new Error(`the answer does not point at ${next}`);
    }
    if (!/\(Google: 404/.test(text)) throw new Error("Google's own code is not kept after the sentence");

    const malformed = await ctx.call("gws-mcp__gmail_read", { message_id: MALFORMED_ID }, { as: "reader" });
    const why = resultText(malformed).trim();
    ctx.evidence(`malformed id: isError=${malformed.isError === true}; worded: ${why.startsWith(`Gmail does not read ${MALFORMED_ID}`)}`);
    if (!malformed.isError) throw new Error("reading an id Gmail cannot read reported success");
    if (!why.startsWith(`Gmail does not read ${MALFORMED_ID} as a message id`)) {
      throw new Error("an id Gmail cannot read is not answered in words");
    }
  },
};
