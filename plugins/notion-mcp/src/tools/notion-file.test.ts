import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NotionClient } from "../notion-client.js";
import { fakeFetch } from "../fixtures/fake-fetch.js";
import { recorded } from "../fixtures/load.js";
import { attachNotionFile, blockTypeFor, handleNotionFile, MAX_FILE_BYTES, SINGLE_PART_MAX_BYTES } from "./notion-file.js";

/* notion_attach_file (SCRUM-501) through the real client against a stubbed
 * fetch. No live upload is run from here: what is pinned is the order of the
 * requests, each one's shape, and what the receipt says. The file upload
 * answers are shaped from Notion's reference for 2026-03-11; the page and the
 * bot user are recorded. */

const TOKEN = "fixture-bearer-not-a-real-token";
const write = () => new NotionClient({ accessToken: TOKEN }).forTool(false);
const PAGE = "122f53f3-d53e-4072-842d-9891b983e4e0";
const UPLOAD = "2e6a1b4c-5d7f-48a9-b0c1-d2e3f4a5b6c7";
const BLOCK = "3f7b2c5d-6e80-49aa-b1c2-d3e4f5a6b7c8";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const page = recorded("page");
const me = recorded("users-me");
const text = (s: string) => new TextEncoder().encode(s);
const file = (bytes: Uint8Array, name = "notes.txt", type = "text/plain") => ({ bytes, name, type });
const created = { object: "file_upload", id: UPLOAD, status: "pending", filename: "notes.txt", content_type: "text/plain" };
const uploaded = (length: number) => ({ ...created, status: "uploaded", content_length: length });
const appended = (type: string) => ({ object: "list", results: [{ object: "block", id: BLOCK, type }] });

describe("blockTypeFor", () => {
  it.each([
    ["image/png", "image"],
    ["image/jpeg", "image"],
    ["application/pdf", "pdf"],
    ["text/plain", "file"],
    ["application/zip", "file"],
    ["image/x-unknown", "file"],
  ])("%s goes on the page as %s", (mime, block) => {
    expect(blockTypeFor(mime)).toBe(block);
  });
});

describe("notion_attach_file", () => {
  it("reads the page and the limit, creates the upload, sends the bytes, appends the block, and answers a receipt", async () => {
    const bytes = text("meeting notes\n");
    const f = fakeFetch([
      { status: 200, body: page.body },
      { status: 200, body: me.body },
      { status: 200, body: created },
      { status: 200, body: uploaded(bytes.byteLength) },
      { status: 200, body: appended("file") },
    ]);
    const res = await attachNotionFile(write(), { page_id: PAGE, file: { type: "content" } }, file(bytes));
    const receipt = JSON.parse(res.content[0].text);

    expect(f.sent.map((r) => `${r.method} ${r.url.pathname}`)).toEqual([
      `GET /v1/pages/${PAGE}`,
      "GET /v1/users/me",
      "POST /v1/file_uploads",
      `POST /v1/file_uploads/${UPLOAD}/send`,
      `PATCH /v1/blocks/${PAGE}/children`,
    ]);
    expect(f.sent[2].body).toEqual({ mode: "single_part", filename: "notes.txt", content_type: "text/plain" });
    const sentFile = f.sent[3].form?.get("file") as File;
    expect(sentFile.name).toBe("notes.txt");
    expect(new Uint8Array(await sentFile.arrayBuffer())).toEqual(bytes);
    expect(f.sent[3].headers["Content-Type"]).toBeUndefined();
    expect(f.sent[4].body).toEqual({
      children: [{ object: "block", type: "file", file: { type: "file_upload", file_upload: { id: UPLOAD } } }],
    });

    expect(receipt).toEqual({
      block: { id: BLOCK, type: "file" },
      file: { name: "notes.txt", size: bytes.byteLength, mime_type: "text/plain" },
      sent: { bytes: bytes.byteLength, sha256: createHash("sha256").update(bytes).digest("hex") },
      page: { id: PAGE, title: expect.any(String), url: page.body.url },
      source: { type: "content" },
    });
  });

  it("a PDF goes on the page as a PDF block, and an image as an image block, under the name given", async () => {
    for (const [type, block] of [["application/pdf", "pdf"], ["image/png", "image"]] as const) {
      const bytes = text("x");
      const f = fakeFetch([
        { status: 200, body: page.body },
        { status: 200, body: me.body },
        { status: 200, body: created },
        { status: 200, body: uploaded(1) },
        { status: 200, body: appended(block) },
      ]);
      await attachNotionFile(write(), { page_id: PAGE, filename: "renamed.bin" }, file(bytes, "orig", type));
      expect(f.sent[2].body).toMatchObject({ filename: "renamed.bin", content_type: type });
      expect((f.sent[4].body as { children: Array<{ type: string }> }).children[0].type).toBe(block);
    }
  });

  it("a file over the workspace's own limit is refused before anything is uploaded", async () => {
    const f = fakeFetch([
      { status: 200, body: page.body },
      { status: 200, body: me.body },
    ]);
    const big = new Uint8Array(5 * 1024 * 1024 + 1);
    await expect(attachNotionFile(write(), { page_id: PAGE }, file(big))).rejects.toThrow(
      /this Notion workspace accepts files of at most 5 MB \(a free workspace allows 5 MB\)\. Nothing was sent\./
    );
    expect(f.sent).toHaveLength(2);
    expect(f.pending()).toBe(0);
  });

  it("a file over Notion's single-part size is refused without asking for the limit", async () => {
    const f = fakeFetch([{ status: 200, body: page.body }]);
    const big = new Uint8Array(SINGLE_PART_MAX_BYTES + 1);
    await expect(attachNotionFile(write(), { page_id: PAGE }, file(big))).rejects.toThrow(
      /sends a file to Notion in one part, which Notion allows up to 20 MB\. Nothing was sent\./
    );
    expect(f.sent).toHaveLength(1);
    expect(SINGLE_PART_MAX_BYTES).toBeLessThan(MAX_FILE_BYTES);
  });

  it("a page Notion does not find is refused before anything is uploaded", async () => {
    const f = fakeFetch([{ status: 404, body: recorded("err-not-found").body }]);
    await expect(attachNotionFile(write(), { page_id: PAGE }, file(text("x")))).rejects.toThrow(/did not find this page/);
    expect(f.sent).toHaveLength(1);
  });

  it("a page id that is not one is refused before any request", async () => {
    const f = fakeFetch([]);
    await expect(attachNotionFile(write(), { page_id: "not an id" }, file(text("x")))).rejects.toThrow(/page_id/);
    expect(f.sent).toHaveLength(0);
  });

  it("a refused append says nothing was attached, keeps Notion's status, and is not sent again", async () => {
    const f = fakeFetch([
      { status: 200, body: page.body },
      { status: 200, body: me.body },
      { status: 200, body: created },
      { status: 200, body: uploaded(1) },
      { status: 400, body: { object: "error", status: 400, code: "validation_error", message: "bad block" } },
    ]);
    const err = (await attachNotionFile(write(), { page_id: PAGE }, file(text("x"))).then(
      () => new Error("resolved"),
      (e: unknown) => e
    )) as Error & { status?: number };
    expect(err.message).toMatch(/^Notion took the file but did not add it to the page\. Nothing was attached to the page/);
    expect(err.status).toBe(400);
    expect(f.sent).toHaveLength(5);
  });

  it("an append that got no answer says it is not known whether the file is on the page", async () => {
    const answers = [
      { status: 200, body: page.body },
      { status: 200, body: me.body },
      { status: 200, body: created },
      { status: 200, body: uploaded(1) },
    ];
    const f = fakeFetch(answers);
    const real = globalThis.fetch;
    let n = 0;
    vi.stubGlobal("fetch", async (...a: Parameters<typeof fetch>) => {
      n++;
      if (n === 5) throw new TypeError("fetch failed");
      return real(...a);
    });
    const err = (await attachNotionFile(write(), { page_id: PAGE }, file(text("x"))).then(
      () => new Error("resolved"),
      (e: unknown) => e
    )) as Error;
    expect(err.name).toBe("NotionUnreachableError");
    expect(err.message).toMatch(/it is not known whether the file is on the page\. It was not retried; look at the page/);
    expect(f.sent).toHaveLength(4);
  });

  it("through /mcp the call carries no bytes and is refused in words", async () => {
    await expect(handleNotionFile(write(), "notion_attach_file", { page_id: PAGE })).rejects.toThrow(
      /needs the gateway to resolve the file reference and hand over the bytes.*Nothing was sent\./
    );
  });
});
