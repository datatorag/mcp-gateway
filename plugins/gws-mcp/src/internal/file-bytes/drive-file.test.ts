import { describe, expect, it } from "vitest";
import { fakeClient } from "../../tools/fake-client.test-helper.js";
import { handleFileBytes } from "../file-bytes.js";
import { driveFileName } from "./drive-file.js";
import type { FileBytesResponse } from "./shared.js";

/** SCRUM-428 Part B: a Drive file as stored, and a native file exported.
 * Every refusal is decided from the metadata, so each refusal test also
 * asserts that no byte was asked for. */

const ID = "1AbC_d-EfG";
type Plan = Parameters<typeof fakeClient>[0];

const request = (ref: unknown, maxBytes = 1_000_000) => JSON.stringify({ ref, max_bytes: maxBytes });
async function run(plan: Plan, ref: unknown, maxBytes?: number) {
  const { client, calls } = fakeClient(plan);
  const res = await handleFileBytes({ method: "POST", token: "t", body: request(ref, maxBytes) }, () => client);
  return { res, calls };
}
const errorOf = (res: FileBytesResponse) => JSON.parse(res.body.toString("utf8")) as { error: string; code: string };
const nameOf = (res: FileBytesResponse) => decodeURIComponent(res.headers["X-File-Name"]);
const downloads = (calls: Array<Record<string, unknown>>) => calls.filter((c) => c.download === true);
const meta = (over: Record<string, unknown>) => ({ data: { id: ID, name: "Q3 report.pdf", mimeType: "application/pdf", size: "9", ...over } });
const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const googleSays = (code: number, message: string) => ({ throws: `API error: ${JSON.stringify({ error: { code, message } })}` });

describe("drive_file: a Drive file as stored", () => {
  const bytes = Buffer.from("%PDF-1.7\x00\xff", "latin1");

  it("reads the metadata, then the file's own bytes, under its Drive name and type", async () => {
    const { res, calls } = await run([meta({}), { bytes }], { type: "drive_file", file_id: ID });
    expect(res.status).toBe(200);
    expect(res.body.equals(bytes)).toBe(true);
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(nameOf(res)).toBe("Q3 report.pdf");
    expect(calls[0]).toMatchObject({ service: "drive", resource: "files", method: "get", params: { fileId: ID, supportsAllDrives: true } });
    expect(calls[1]).toMatchObject({ download: true, service: "drive", resource: "files", method: "get", params: { fileId: ID, supportsAllDrives: true } });
  });

  it("refuses a native file with the drive_export reference to use, and reads no bytes", async () => {
    const { res, calls } = await run([meta({ mimeType: DOC, name: "Plan" })], { type: "drive_file", file_id: ID });
    expect(res.status).toBe(400);
    expect(errorOf(res).error).toContain(`{"type":"drive_export","file_id":"${ID}","format":"pdf"}`);
    expect(downloads(calls)).toHaveLength(0);
  });

  it.each([
    [{ mimeType: "application/vnd.google-apps.folder" }, /folder/],
    [{ mimeType: "application/vnd.google-apps.shortcut", shortcutDetails: { targetId: "T9" } }, /shortcut.*T9/],
    [{ trashed: true }, /Trash/],
    [{ mimeType: "application/vnd.google-apps.form" }, /cannot be exported/],
  ])("refuses %j from the metadata alone", async (over, message) => {
    const { res, calls } = await run([meta(over)], { type: "drive_file", file_id: ID });
    expect(res.status).toBe(400);
    expect(errorOf(res).error).toMatch(message);
    expect(downloads(calls)).toHaveLength(0);
  });

  it("refuses a file Drive says is over the cap before reading it", async () => {
    const { res, calls } = await run([meta({ size: "2000" })], { type: "drive_file", file_id: ID }, 1000);
    expect(res.status).toBe(413);
    expect(downloads(calls)).toHaveLength(0);
  });

  it("stops at the cap when the bytes run past what Drive declared", async () => {
    const { res } = await run([meta({ size: "5" }), { bytes: Buffer.alloc(2000) }], { type: "drive_file", file_id: ID }, 1000);
    expect(res.status).toBe(413);
  });

  it("serves an implausible declared type as octet-stream", async () => {
    const { res } = await run([meta({ mimeType: "text/html; charset=x\r\nX: y" }), { bytes }], { type: "drive_file", file_id: ID });
    expect(res.headers["Content-Type"]).toBe("application/octet-stream");
  });

  it("says a missing file is missing in Drive, not in Gmail", async () => {
    const { res } = await run([googleSays(404, "File not found")], { type: "drive_file", file_id: ID });
    expect(res.status).toBe(404);
    expect(errorOf(res).error).toMatch(/^Drive has no file/);
  });

  it.each([[""], ["../x"], ["a b"], [7]])("refuses file_id %j before any call", async (file_id) => {
    const { res, calls } = await run([], { type: "drive_file", file_id });
    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });
});

describe("drive_export: a native file rendered to a format", () => {
  const pdf = Buffer.from("%PDF-1.4 exported");

  it("exports a Doc as PDF, named with the extension", async () => {
    const { res, calls } = await run([meta({ mimeType: DOC, name: "Launch plan" }), { bytes: pdf }], { type: "drive_export", file_id: ID, format: "pdf" });
    expect(res.status).toBe(200);
    expect(res.body.equals(pdf)).toBe(true);
    expect(res.headers["Content-Type"]).toBe("application/pdf");
    expect(nameOf(res)).toBe("Launch plan.pdf");
    expect(calls[1]).toMatchObject({ download: true, resource: "files", method: "export", params: { fileId: ID, mimeType: "application/pdf" } });
  });

  it("exports a Sheet's csv through files.export, the first tab", async () => {
    const { res, calls } = await run([meta({ mimeType: SHEET, name: "Budget" }), { text: "a,b\r\n" }], { type: "drive_export", file_id: ID, format: "csv" });
    expect(res.headers["Content-Type"]).toBe("text/csv");
    expect(nameOf(res)).toBe("Budget.csv");
    expect(calls[1]).toMatchObject({ method: "export", params: { mimeType: "text/csv" } });
  });

  it("refuses a format the kind cannot take, listing the ones it can", async () => {
    const { res, calls } = await run([meta({ mimeType: DOC })], { type: "drive_export", file_id: ID, format: "xlsx" });
    expect(res.status).toBe(400);
    expect(errorOf(res).error).toMatch(/Docs file exports as pdf, docx/);
    expect(downloads(calls)).toHaveLength(0);
  });

  it("refuses a stored file with the drive_file reference to use", async () => {
    const { res, calls } = await run([meta({})], { type: "drive_export", file_id: ID, format: "pdf" });
    expect(errorOf(res).error).toContain(`{"type":"drive_file","file_id":"${ID}"}`);
    expect(downloads(calls)).toHaveLength(0);
  });

  it("refuses an unknown format before any call", async () => {
    const { res, calls } = await run([], { type: "drive_export", file_id: ID, format: "exe" });
    expect(res.status).toBe(400);
    expect(errorOf(res).error).toMatch(/ref.format must be one of/);
    expect(calls).toHaveLength(0);
  });

  it("reads Google's export limit as a size, not a permissions failure", async () => {
    const { res } = await run(
      [meta({ mimeType: DOC }), googleSays(403, "This file is too large to be exported.")],
      { type: "drive_export", file_id: ID, format: "pdf" }
    );
    expect(res.status).toBe(413);
    expect(errorOf(res).code).toBe("too_large");
  });

  it("caps an export, whose size is not known in advance, while it streams", async () => {
    const { res } = await run([meta({ mimeType: DOC }), { bytes: Buffer.alloc(2000) }], { type: "drive_export", file_id: ID, format: "pdf" }, 1000);
    expect(res.status).toBe(413);
  });
});

describe("Drive file names", () => {
  it("keeps an existing extension, adds the export's, and never doubles it", () => {
    expect(driveFileName("notes.txt", ID)).toBe("notes.txt");
    expect(driveFileName("Plan", ID, ".pdf")).toBe("Plan.pdf");
    expect(driveFileName("Plan.PDF", ID, ".pdf")).toBe("Plan.pdf");
    expect(driveFileName("a/b:c", ID)).toBe("abc");
    expect(driveFileName("", ID, ".pdf")).toBe(`drive-file-${ID}.pdf`);
  });
});
