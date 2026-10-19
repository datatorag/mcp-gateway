import type { TestCase } from "../types";
import { saveThroughLink } from "../drive-reference";

/**
 * FD4 (Drive scenario, SCRUM-428): the fixture Doc, named by a `drive_export`
 * reference with format pdf, downloads as a PDF.
 *
 * The bytes are checked against the receipt by the shared helper; here the
 * check is that they ARE a PDF (the file starts with the PDF signature), that
 * they go out as application/pdf, the type the caller chose, and under a
 * name ending .pdf. It reads and changes nothing.
 */
export const fd4DownloadDocPdf: TestCase = {
  id: "FD4",
  title: "a Doc named by a drive_export reference downloads as a PDF",
  covers: ["file_download_link"],
  accounts: ["sender"],
  fixtures: ["doc"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const saved = await saveThroughLink(
      ctx,
      await ctx.call("file_download_link", {
        file: { type: "drive_export", file_id: ctx.fixture("doc"), format: "pdf", account: ctx.address("sender") },
      })
    );
    const signature = saved.body.subarray(0, 5).toString("latin1");
    ctx.evidence(`${saved.body.length} bytes as ${saved.type}; starts as a PDF: ${signature === "%PDF-"}; name ends .pdf: ${saved.name.endsWith(".pdf")}`);
    if (signature !== "%PDF-") throw new Error("the exported file does not start with the PDF signature");
    if (saved.type !== "application/pdf") throw new Error(`the export was sent as ${saved.type}, not application/pdf`);
    if (!saved.name.endsWith(".pdf")) throw new Error("the export's name does not end in .pdf");
  },
};
