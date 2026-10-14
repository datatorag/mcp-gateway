/**
 * SCRUM-421: drive_upload_file, driven through a fake client. The fake
 * records every call, so the order (folder and account before the upload,
 * the upload once) and what is sent are pinned, not just the receipt.
 */

import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { GwsClient } from "../gws-client.js";
import { driveUploadTools, handleDriveUpload, uploadReferencedFile } from "./drive-upload.js";

const BYTES = Buffer.from("From: a@example.com\r\nSubject: fixture\r\n\r\nbody\r\n");
const SHA = createHash("sha256").update(BYTES).digest("hex");
const FILE = { bytes: new Uint8Array(BYTES), name: "Quarterly report.eml", type: "message/rfc822" };

type Call = { kind: "api" | "upload"; service: string; resource: string; method: string; options: any; body?: Buffer };

function fake(over: {
  folder?: Record<string, unknown> | Error;
  stored?: Record<string, unknown>;
  storedOnGet?: Record<string, unknown>;
} = {}) {
  const calls: Call[] = [];
  const folder = over.folder ?? {
    id: "folder-1",
    name: "Filed mail",
    mimeType: "application/vnd.google-apps.folder",
    owners: [{ emailAddress: "owner@example.com", me: true }],
    shared: false,
    capabilities: { canAddChildren: true },
  };
  const stored = over.stored ?? {
    id: "file-1",
    name: FILE.name,
    mimeType: "message/rfc822",
    size: String(BYTES.length),
    webViewLink: "https://drive.example.test/file-1",
    parents: ["folder-1"],
    md5Checksum: "0".repeat(32),
    sha256Checksum: SHA,
  };
  const client = {
    async api(service: string, resource: string, method: string, options: any) {
      calls.push({ kind: "api", service, resource, method, options });
      if (resource === "about") return { data: { user: { emailAddress: "receiver@example.com" } } };
      if (resource === "files" && method === "get" && options.params.fileId === "file-1") return { data: over.storedOnGet ?? {} };
      if (folder instanceof Error) throw folder;
      return { data: folder };
    },
    async upload(service: string, resource: string, method: string, options: any) {
      const chunks: Buffer[] = [];
      for await (const chunk of options.source) chunks.push(Buffer.from(chunk));
      calls.push({ kind: "upload", service, resource, method, options, body: Buffer.concat(chunks) });
      return { data: stored };
    },
  } as unknown as GwsClient;
  return { client, calls };
}

const receiptOf = (res: { content: { text: string }[] }) => JSON.parse(res.content[0].text.slice(res.content[0].text.indexOf("{")));

describe("drive_upload_file", () => {
  it("is a create, and describes rather than instructs", () => {
    const [tool] = driveUploadTools;
    expect(tool.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false, title: "Upload a file to Drive" });
    expect(tool.inputSchema.required).toEqual(["file"]);
    expect(tool.description).not.toMatch(/\b(always|must|do not|don't|should)\b/i);
  });

  it("an ordinary call with no bytes uploads nothing and says why", async () => {
    const res = await handleDriveUpload();
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("Nothing was uploaded");
  });

  it("reads the folder and the account first, then uploads the exact bytes once, under the source's name and type", async () => {
    const { client, calls } = fake();
    const res = await uploadReferencedFile(client, { folder_id: "folder-1" }, FILE);
    expect(res.isError).toBeUndefined();
    expect(calls.map((c) => `${c.kind}:${c.resource}.${c.method}`)).toEqual(["api:files.get", "api:about.get", "upload:files.create"]);
    const upload = calls[2];
    expect(upload.body!.equals(BYTES)).toBe(true);
    expect(upload.options.metadata).toEqual({ name: "Quarterly report.eml", parents: ["folder-1"] });
    expect(upload.options.contentType).toBe("message/rfc822");
    expect(upload.options.params.fields).toContain("sha256Checksum");
    expect(upload.options.params.fields).toContain("md5Checksum");
  });

  it("answers the receipt: the file, what was sent, what Drive stored, the folder and the account", async () => {
    const receipt = receiptOf(await uploadReferencedFile(fake().client, { folder_id: "folder-1" }, FILE));
    expect(receipt).toEqual({
      file: {
        id: "file-1",
        name: "Quarterly report.eml",
        size: BYTES.length,
        mimeType: "message/rfc822",
        webViewLink: "https://drive.example.test/file-1",
        parents: ["folder-1"],
      },
      sent: { bytes: BYTES.length, sha256: SHA },
      stored: { sha256: SHA, md5: "0".repeat(32) },
      checksum_match: true,
      folder: {
        id: "folder-1",
        name: "Filed mail",
        owners: ["owner@example.com"],
        owned_by_receiving_account: true,
        shared: false,
        in_shared_drive: false,
      },
      account: "receiver@example.com",
    });
  });

  it("goes to the root of My Drive with no folder, and sends no parents", async () => {
    const { client, calls } = fake();
    await uploadReferencedFile(client, {}, FILE);
    expect(calls[0].options.params.fileId).toBe("root");
    expect(calls[2].options.metadata).toEqual({ name: "Quarterly report.eml" });
  });

  it("reports a folder someone else owns, shared or in a shared drive, and uploads anyway", async () => {
    const { client, calls } = fake({
      folder: {
        id: "theirs",
        name: "Their folder",
        mimeType: "application/vnd.google-apps.folder",
        owners: [{ emailAddress: "stranger@example.com", me: false }],
        shared: true,
        driveId: "drive-9",
        capabilities: { canAddChildren: true },
      },
    });
    const res = await uploadReferencedFile(client, { folder_id: "theirs" }, FILE);
    expect(res.isError).toBeUndefined();
    expect(calls.some((c) => c.kind === "upload")).toBe(true);
    expect(receiptOf(res).folder).toEqual({
      id: "theirs",
      name: "Their folder",
      owners: ["stranger@example.com"],
      owned_by_receiving_account: false,
      shared: true,
      in_shared_drive: true,
    });
  });

  it.each([
    ["a folder that does not exist", { folder: new Error('API error: {"error":{"code":404,"message":"File not found"}}') }, "no folder with that id"],
    ["a file that is not a folder", { folder: { id: "x", mimeType: "application/pdf", capabilities: { canAddChildren: false } } }, "not a folder"],
    ["a folder this account cannot add to", { folder: { id: "x", mimeType: "application/vnd.google-apps.folder", capabilities: { canAddChildren: false } } }, "cannot add files"],
  ])("refuses %s before anything is uploaded", async (_label, over, words) => {
    const { client, calls } = fake(over as never);
    const res = await uploadReferencedFile(client, { folder_id: "x" }, FILE);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain(words);
    expect(res.content[0].text).toContain("Nothing was uploaded");
    expect(calls.some((c) => c.kind === "upload")).toBe(false);
  });

  it.each([["../x"], ["a b"], [42], [""]])("refuses a folder_id that is not an id (%j), before any call", async (folder_id) => {
    const { client, calls } = fake();
    const res = await uploadReferencedFile(client, { folder_id }, FILE);
    expect(res.isError).toBe(true);
    expect(calls).toEqual([]);
  });

  it("a stored file that does not match is an error that still carries the whole receipt, and is not deleted", async () => {
    const { client, calls } = fake({ stored: { id: "file-1", size: String(BYTES.length), sha256Checksum: "f".repeat(64), md5Checksum: "1".repeat(32) } });
    const res = await uploadReferencedFile(client, {}, FILE);
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toContain("does not match");
    expect(res.content[0].text).toContain("not deleted");
    const receipt = receiptOf(res);
    expect(receipt.checksum_match).toBe(false);
    expect(receipt.file.id).toBe("file-1");
    expect(calls.filter((c) => c.method === "delete")).toEqual([]);
  });

  it("asks once more for the checksums when the create answer has none", async () => {
    const { client, calls } = fake({
      stored: { id: "file-1", size: String(BYTES.length) },
      storedOnGet: { sha256Checksum: SHA, md5Checksum: "2".repeat(32) },
    });
    const receipt = receiptOf(await uploadReferencedFile(client, {}, FILE));
    expect(calls.map((c) => `${c.kind}:${c.resource}.${c.method}`)).toEqual([
      "api:files.get",
      "api:about.get",
      "upload:files.create",
      "api:files.get",
    ]);
    expect(receipt.checksum_match).toBe(true);
    expect(receipt.stored).toEqual({ sha256: SHA, md5: "2".repeat(32) });
  });

  it("with no checksum at all, compares sizes and says the checksum could not be compared", async () => {
    const ok = receiptOf(await uploadReferencedFile(fake({ stored: { id: "file-1", size: String(BYTES.length) } }).client, {}, FILE));
    expect(ok.checksum_match).toBeNull();
    expect(ok.size_match).toBe(true);
    const bad = await uploadReferencedFile(fake({ stored: { id: "file-1", size: "1" } }).client, {}, FILE);
    expect(bad.isError).toBe(true);
    expect(receiptOf(bad).size_match).toBe(false);
  });
});
