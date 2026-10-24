import { createHash } from "node:crypto";
import type { TestCase } from "../types";
import { resultJson } from "../result-json";
import { uploadThroughLink } from "../upload-link";

type Draft = { id?: string; attachments?: Array<{ source?: string; size?: number; sha256?: string }> };

/**
 * FD17 (Gmail scenario, SCRUM-437): a file sent through an upload link is
 * attached to a draft by its upload reference, and the draft's report gives
 * the hash of the bytes the case sent. Addressed to the reader; NOTHING IS
 * SENT, and the draft is deleted in the same run.
 */
export const fd17UploadOnADraft: TestCase = {
  id: "FD17",
  title: "a file sent through an upload link is attached to an email draft",
  covers: ["file_upload_link", "gws-mcp__gmail_create_draft", "gws-mcp__gmail_delete_draft"],
  accounts: ["sender", "reader"],
  crossesFiles: true,
  timeoutMs: 120_000,
  run: async (ctx) => {
    const bytes = Buffer.from(`Uploaded by the smoke suite, run ${ctx.stamp}.\n`);
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const { upload_id } = await uploadThroughLink(ctx, await ctx.call("file_upload_link", {}), { bytes, name: `fd17-${ctx.stamp}.txt`, sha256 });
    const draft = resultJson<Draft>(
      "gmail_create_draft",
      await ctx.call(
        "gws-mcp__gmail_create_draft",
        { to: ctx.address("reader"), subject: `[smoke] FD17 ${ctx.stamp}`, body: "An uploaded file.", attachments: [{ type: "upload", upload_id }] },
        { as: "sender" }
      )
    );
    const draftId = draft.id;
    if (!draftId) throw new Error("gmail_create_draft returned no id, so the draft cannot be deleted");
    ctx.defer("delete the draft", async () => {
      await ctx.call("gws-mcp__gmail_delete_draft", { draft_id: draftId }, { as: "sender" });
    });
    const report = draft.attachments ?? [];
    ctx.evidence(`report entries: ${report.length}; the file's hash is the case's: ${report[0]?.sha256 === sha256}`);
    if (report.length !== 1 || report[0].source !== "supplied" || report[0].sha256 !== sha256 || report[0].size !== bytes.length) {
      throw new Error("the draft's report is not the uploaded file");
    }
  },
};
