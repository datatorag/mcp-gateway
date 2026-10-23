/**
 * SCRUM-421: the private route the gateway hands this plugin a file on.
 * The same route atlassian-mcp has, with its own table of tools; these pin
 * the refusals that come before any Google call, and the one tool it serves.
 */

import { describe, expect, it } from "vitest";
import { CONSUME_PATH, handleConsume } from "./consume.js";

async function* body(...chunks: Uint8Array[]) {
  for (const chunk of chunks) yield chunk;
}

/** A multipart body as the gateway builds it (SCRUM-437). */
async function handoff(
  args: unknown = { folder_id: "folder-1" },
  files: Array<{ field: string; name: string; type: string; bytes: Uint8Array }> = [
    { field: "file", name: "Quarterly report.eml", type: "message/rfc822", bytes: new Uint8Array([1, 2, 3]) },
  ]
): Promise<{ contentType: string; bytes: Uint8Array }> {
  const form = new FormData();
  form.append("args", JSON.stringify(args));
  for (const f of files) form.append(f.field, new Blob([f.bytes as Uint8Array<ArrayBuffer>], { type: f.type }), f.name);
  const res = new Response(form);
  return { contentType: res.headers.get("content-type") as string, bytes: new Uint8Array(await res.arrayBuffer()) };
}

const headers = (contentType: string, over: Record<string, string | undefined> = {}) => ({
  "x-user-token": "token-fixture",
  "x-tool-name": "drive_upload_file",
  "content-type": contentType,
  ...over,
});

describe("POST /internal/consume", () => {
  it("is the path the gateway calls", () => {
    expect(CONSUME_PATH).toBe("/internal/consume");
  });

  it.each([
    ["a method other than POST", { method: "GET" }, {}, 405, "method_not_allowed"],
    ["no token", { method: "POST" }, { "x-user-token": undefined }, 401, "no_token"],
    ["a tool this route does not serve", { method: "POST" }, { "x-tool-name": "drive_search" }, 404, "unknown_tool"],
    ["a body that is not multipart", { method: "POST" }, { "content-type": "application/octet-stream" }, 400, "bad_request"],
    ["a declared length past the body cap", { method: "POST" }, { "content-length": String(27 * 1024 * 1024) }, 413, "too_large"],
  ])("refuses %s", async (_label, req, over, status, code) => {
    const h = await handoff();
    const res = await handleConsume({ ...req, headers: headers(h.contentType, over), body: body(h.bytes) } as never);
    expect(res.status).toBe(status);
    expect((res.body as { code: string }).code).toBe(code);
  });

  it("refuses an empty body, a malformed one, and files over 25 MB together", async () => {
    const h = await handoff();
    const empty = await handleConsume({ method: "POST", headers: headers(h.contentType), body: body() });
    expect(empty.status).toBe(400);
    const garbled = await handleConsume({ method: "POST", headers: headers(h.contentType), body: body(new Uint8Array([1, 2, 3])) });
    expect(garbled.status).toBe(400);
    const big = await handoff(undefined, [
      { field: "file", name: "big.bin", type: "application/octet-stream", bytes: new Uint8Array(25 * 1024 * 1024 + 1) },
    ]);
    const over = await handleConsume({ method: "POST", headers: headers(big.contentType), body: body(big.bytes) });
    expect(over.status).toBe(413);
  });

  it("takes one file a call for drive_upload_file", async () => {
    const two = await handoff(undefined, [
      { field: "file", name: "a.bin", type: "application/octet-stream", bytes: new Uint8Array([1]) },
      { field: "attachments[0]", name: "b.bin", type: "application/octet-stream", bytes: new Uint8Array([2]) },
    ]);
    const res = await handleConsume({ method: "POST", headers: headers(two.contentType), body: body(two.bytes) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      content: [{ type: "text", text: "This tool takes one file a call. Nothing was uploaded." }],
      isError: true,
    });
  });

  it("serves drive_upload_file, and an ordinary tool name is not reachable through it", async () => {
    const h = await handoff();
    for (const name of ["drive_search", "gmail_save_attachment_to_drive", "gws_run"]) {
      const res = await handleConsume({ method: "POST", headers: headers(h.contentType, { "x-tool-name": name }), body: body(h.bytes) });
      expect(res.status, name).toBe(404);
    }
  });
});
