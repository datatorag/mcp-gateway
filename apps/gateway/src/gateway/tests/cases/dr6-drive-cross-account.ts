import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Receipt = {
  file?: { id?: string | null; name?: string | null; size?: number | null };
  sent?: { bytes?: number };
  checksum_match?: boolean | null;
  folder?: { owned_by_receiving_account?: boolean };
};

/**
 * DR6 (Drive scenario, SCRUM-428): a file is copied from one Google account's
 * Drive into another's. The fixture Doc lives in the sender's Drive; the call
 * runs as the reader, with a `drive_export` reference whose account is the
 * sender, so the PDF of it lands in the root of the reader's My Drive.
 * drive_copy_file cannot do this: it works within one account.
 *
 * The claim is Drive's own: the SHA-256 the reader's Drive reports for what
 * it stored matches what was sent, the sizes agree, and the receipt says the
 * folder belongs to the receiving account. The copy is trashed at the end.
 */
export const dr6DriveCrossAccount: TestCase = {
  id: "DR6",
  title: "a Doc in one account's Drive is copied as a PDF into another account's Drive, checksum intact",
  covers: ["gws-mcp__drive_upload_file", "gws-mcp__drive_trash_file"],
  accounts: ["reader", "sender"],
  distinctAccounts: true,
  fixtures: ["doc"],
  timeoutMs: 150_000,
  run: async (ctx) => {
    const receipt = resultJson<Receipt>(
      "drive_upload_file",
      await ctx.call(
        "gws-mcp__drive_upload_file",
        { file: { type: "drive_export", file_id: ctx.fixture("doc"), format: "pdf", account: ctx.address("sender") } },
        { as: "reader" }
      )
    );
    const file_id = receipt.file?.id;
    if (typeof file_id !== "string") throw new Error("the receipt names no file id, so the copy cannot be checked or removed");
    ctx.defer("trash the copy in the reader's Drive", async () => {
      const res = await ctx.call("gws-mcp__drive_trash_file", { file_id }, { as: "reader" });
      if (res.isError) ctx.evidence("RESIDUE: the copy in the reader's Drive could not be trashed");
    });
    const sent = receipt.sent?.bytes;
    ctx.evidence(`${sent} bytes sent, Drive reports ${receipt.file?.size}; checksum_match ${String(receipt.checksum_match)}`);
    if (receipt.checksum_match !== true) throw new Error("the receiving Drive's SHA-256 is not that of what was sent");
    if (typeof sent !== "number" || sent <= 0 || receipt.file?.size !== sent) throw new Error("the size Drive reports is not the size sent");
    if (receipt.folder?.owned_by_receiving_account !== true) throw new Error("the copy did not land in a folder the receiving account owns");
    if (!(receipt.file?.name ?? "").endsWith(".pdf")) throw new Error("the copy is not named as a PDF");
  },
};
