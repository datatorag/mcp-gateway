import type { TestCase } from "./types";
import { resultJson } from "./result-json";

/*
 * NOT REGISTERED YET, on purpose. Every registered case runs, including a
 * pending one, and this one leaves a file in Drive unless it can remove it.
 * The tool that removes it (`drive_trash_file`) is in review and not on main.
 * When it is: move this file to cases/dr5-drive-upload.ts (fixing its two imports), add it to cases/index.ts and to
 * the Drive scenario in scenarios.ts. Until then it is typechecked and
 * nothing more.
 */

type Receipt = {
  file?: { id?: string | null; size?: number | null };
  sent?: { bytes?: number; sha256?: string };
  stored?: { sha256?: string | null; md5?: string | null };
  checksum_match?: boolean | null;
  folder?: { owned_by_receiving_account?: boolean };
};

/**
 * DR5 (Drive scenario): the standing message is put into the reader's Drive
 * through a file reference, and what Drive stored is what was sent.
 *
 * THE CLAIM IS DRIVE'S OWN CHECKSUM. The receipt carries the SHA-256 the
 * plugin computed over the bytes it was handed and the one Drive reports
 * for the file it holds; `checksum_match` must be true, and the three
 * sizes (sent, the receipt's file, and Drive's) must agree. Unlike the
 * Jira receipt this compares stored bytes, not sizes alone.
 *
 * The file goes into the fixture folder, which the reader owns, so the
 * folder report must say so.
 *
 * NOTHING ABOUT THE FILE IS WRITTEN DOWN: byte counts and booleans only.
 */
export const dr5DriveUpload: TestCase = {
  id: "DR5",
  title: "a referenced email is uploaded to Drive and Drive's checksum matches what was sent",
  covers: ["gws-mcp__drive_upload_file", "gws-mcp__drive_trash_file"],
  accounts: ["reader"],
  fixtures: ["smokeMessage", "folder"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const receipt = resultJson<Receipt>(
      "drive_upload_file",
      await ctx.call(
        "gws-mcp__drive_upload_file",
        {
          file: { type: "gmail_message", message_id: ctx.fixture("smokeMessage") },
          folder_id: ctx.fixture("folder"),
        },
        { as: "reader" }
      )
    );
    const fileId = receipt.file?.id;
    if (typeof fileId === "string") {
      ctx.defer("trash the uploaded copy", async () => {
        const res = await ctx.call("gws-mcp__drive_trash_file", { file_id: fileId }, { as: "reader" });
        if (res.isError) {
          ctx.evidence("RESIDUE: the uploaded copy could not be trashed");
          throw new Error("the uploaded copy could NOT be trashed and must be removed in Drive");
        }
      });
    } else {
      throw new Error("the receipt names no file id, so the upload cannot be checked or removed");
    }

    const sent = receipt.sent?.bytes;
    const size = receipt.file?.size;
    ctx.evidence(
      `${sent} bytes sent, Drive reports ${size}; checksum_match is ${String(receipt.checksum_match)}`
    );
    if (receipt.checksum_match !== true) {
      throw new Error("Drive's SHA-256 of the stored file is not the SHA-256 of what was sent, or Drive gave none");
    }
    if (typeof sent !== "number" || sent <= 0 || size !== sent) {
      throw new Error("the size Drive reports is not the size that was sent");
    }
    if (receipt.folder?.owned_by_receiving_account !== true) {
      throw new Error("the folder report does not say the reader owns the fixture folder it owns");
    }
  },
};
