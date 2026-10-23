import { createHash } from "node:crypto";
import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { contentFile } from "../content-file";

type Report = { name?: string; mode?: string; source?: string; size?: number; sha256?: string };
type Draft = { id?: string; message?: { id?: string }; attachments?: Report[] };

/**
 * FD10 (Gmail scenario, SCRUM-437): a draft carries two files sent as
 * `content` references beside the fixture Doc, which goes as a link. Read
 * back, the draft holds both files at the sizes the report gives, and each
 * supplied file's reported SHA-256 is the hash of the bytes the case sent.
 *
 * Addressed to the reader, as every draft is; NOTHING IS SENT, and the draft
 * is deleted in the same run.
 */
export const fd10ContentOnADraft: TestCase = {
  id: "FD10",
  title: "a draft carries two files sent as content references beside a Drive file",
  covers: ["gws-mcp__gmail_create_draft", "gws-mcp__gmail_read", "gws-mcp__gmail_delete_draft"],
  accounts: ["sender", "reader"],
  fixtures: ["doc"],
  crossesFiles: true,
  timeoutMs: 120_000,
  run: async (ctx) => {
    const png = contentFile();
    const text = Buffer.from(`Attached by the smoke suite, run ${ctx.stamp}.\n`);
    const textSha = createHash("sha256").update(text).digest("hex");
    const draft = resultJson<Draft>(
      "gmail_create_draft",
      await ctx.call(
        "gws-mcp__gmail_create_draft",
        {
          to: ctx.address("reader"),
          subject: `[smoke] FD10 ${ctx.stamp}`,
          body: "Two files carried in the call, and a Doc as a link.",
          attachments: [
            { type: "content", name: `fd10-${ctx.stamp}.png`, mime_type: "image/png", base64: png.base64 },
            { type: "content", name: `fd10-${ctx.stamp}.txt`, mime_type: "text/plain", base64: text.toString("base64") },
            ctx.fixture("doc"),
          ],
        },
        { as: "sender" }
      )
    );
    const draftId = draft.id;
    if (!draftId) throw new Error("gmail_create_draft returned no id, so the draft cannot be deleted");
    ctx.defer("delete the draft", async () => {
      await ctx.call("gws-mcp__gmail_delete_draft", { draft_id: draftId }, { as: "sender" });
    });

    const report = draft.attachments ?? [];
    const supplied = report.filter((r) => r.source === "supplied");
    const linked = report.filter((r) => r.mode === "linked");
    ctx.evidence(`report entries: ${report.length}; supplied: ${supplied.length}; linked: ${linked.length}`);
    if (supplied.length !== 2 || linked.length !== 1) throw new Error("the report does not list two supplied files and one link");
    if (supplied[0].sha256 !== png.sha256 || supplied[0].size !== png.bytes.length) {
      throw new Error("the first supplied file's report is not the PNG the case sent");
    }
    if (supplied[1].sha256 !== textSha || supplied[1].size !== text.length) {
      throw new Error("the second supplied file's report is not the text the case sent");
    }

    const messageId = draft.message?.id;
    if (!messageId) throw new Error("the draft answered no message id to read it back by");
    const read = resultJson<{ attachments?: Array<{ filename?: string; size?: number }> }>(
      "gmail_read",
      await ctx.call("gws-mcp__gmail_read", { message_id: messageId, text_only: true, max_body_chars: 1 }, { as: "sender" })
    );
    const held = (read.attachments ?? []).map((a) => a.size);
    ctx.evidence(`the draft holds ${held.length} files`);
    if (held.length !== 2) throw new Error("the draft does not hold the two supplied files");
    if (!held.includes(png.bytes.length) || !held.includes(text.length)) {
      throw new Error("the draft's files are not the sizes that were sent");
    }
  },
};
