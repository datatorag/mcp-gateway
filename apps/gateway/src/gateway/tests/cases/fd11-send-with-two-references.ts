import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { deliveredFromSearch, arrivalQuery } from "../mail-parts";
import { contentFile } from "../content-file";

type Attachment = { partId?: string; size?: number };
type Report = { source?: string; size?: number; sha256?: string };

/**
 * FD11 (Gmail scenario, SCRUM-437): an email sent to the reader carries two
 * referenced files of different kinds in one call: one attachment of the
 * standing message, read from the reader's mailbox by a `gmail_attachment`
 * reference, and a file sent as a `content` reference. The reader receives
 * both parts at the sizes the send reported.
 *
 * The 25 MB combined refusal is pinned by the gateway's unit tests, not
 * here: no fixture is large enough to reach it.
 */
export const fd11SendWithTwoReferences: TestCase = {
  id: "FD11",
  title: "an email carries an attachment from another mailbox and a file sent in the call",
  covers: ["gws-mcp__gmail_send", "gws-mcp__gmail_search", "gws-mcp__gmail_read"],
  accounts: ["sender", "reader"],
  distinctAccounts: true,
  fixtures: ["smokeMessage"],
  crossesFiles: true,
  timeoutMs: 180_000,
  run: async (ctx) => {
    const message_id = ctx.fixture("smokeMessage");
    const standing = resultJson<{ attachments?: Attachment[] }>(
      "gmail_read",
      await ctx.call("gws-mcp__gmail_read", { message_id, text_only: true, max_body_chars: 1 }, { as: "reader" })
    );
    const part = (standing.attachments ?? []).find((a) => typeof a.partId === "string" && a.partId !== "" && (a.size ?? 0) > 0);
    if (!part) throw new Error("the standing fixture message carries no attachment to send on");

    const png = contentFile();
    const sent = resultJson<{ id?: string; attachments?: Report[] }>(
      "gmail_send",
      await ctx.call(
        "gws-mcp__gmail_send",
        {
          to: ctx.address("reader"),
          subject: `[smoke] FD11 ${ctx.stamp}`,
          body: "One attachment from another mailbox and one file carried in the call.",
          attachments: [
            { type: "gmail_attachment", message_id, part_id: part.partId, account: ctx.address("reader") },
            { type: "content", name: `fd11-${ctx.stamp}.png`, mime_type: "image/png", base64: png.base64 },
          ],
        },
        { as: "sender" }
      )
    );
    const report = sent.attachments ?? [];
    ctx.evidence(`the send reported ${report.length} attachments, all supplied: ${report.every((r) => r.source === "supplied")}`);
    if (report.length !== 2 || !report.every((r) => r.source === "supplied")) {
      throw new Error("the send did not report two supplied attachments");
    }
    if (report[1].sha256 !== png.sha256) throw new Error("the content file's reported hash is not the file the case sent");
    if (typeof sent.id === "string") {
      const sentId = sent.id;
      ctx.defer("trash the sent copy", async () => {
        const gone = await ctx.trashOwnMessage(sentId, { as: "sender" });
        if (!gone) ctx.evidence("RESIDUE: the sent copy could not be trashed");
      });
    }

    const received = await ctx.until(
      "the message to arrive in the reader mailbox",
      async () => {
        const found = await ctx.call(
          "gws-mcp__gmail_search",
          { query: arrivalQuery(`subject:"FD11 ${ctx.stamp}"`), max_results: 5 },
          { as: "reader" }
        );
        return deliveredFromSearch(found)[0];
      },
      { everyMs: 5_000, forMs: 120_000 }
    );
    ctx.defer("trash the received message", async () => {
      const gone = await ctx.trashOwnMessage(received, { as: "reader" });
      if (!gone) ctx.evidence("RESIDUE: a received message could not be trashed");
    });

    const read = resultJson<{ attachments?: Attachment[] }>(
      "gmail_read",
      await ctx.call("gws-mcp__gmail_read", { message_id: received, text_only: true, max_body_chars: 1 }, { as: "reader" })
    );
    const sizes = (read.attachments ?? []).map((a) => a.size);
    ctx.evidence(`the reader received ${sizes.length} attachments`);
    if (sizes.length !== 2) throw new Error("the received message does not carry the two files");
    for (const r of report) {
      if (!sizes.includes(r.size)) throw new Error("a received attachment is not the size the send reported");
    }
  },
};
