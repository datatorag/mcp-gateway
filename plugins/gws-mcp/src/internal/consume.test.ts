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

const headers = (over: Record<string, string | undefined> = {}) => ({
  "x-user-token": "token-fixture",
  "x-tool-name": "drive_upload_file",
  "x-tool-args": Buffer.from(JSON.stringify({ folder_id: "folder-1" })).toString("base64url"),
  "x-file-name": encodeURIComponent("Quarterly report.eml"),
  "x-file-type": "message/rfc822",
  ...over,
});

describe("POST /internal/consume", () => {
  it("is the path the gateway calls", () => {
    expect(CONSUME_PATH).toBe("/internal/consume");
  });

  it.each([
    ["a method other than POST", { method: "GET", headers: headers() }, 405, "method_not_allowed"],
    ["no token", { method: "POST", headers: headers({ "x-user-token": undefined }) }, 401, "no_token"],
    ["a tool this route does not serve", { method: "POST", headers: headers({ "x-tool-name": "gmail_send" }) }, 404, "unknown_tool"],
    ["arguments that are not base64url JSON", { method: "POST", headers: headers({ "x-tool-args": "not*json" }) }, 400, "bad_request"],
    ["no file name", { method: "POST", headers: headers({ "x-file-name": undefined }) }, 400, "bad_request"],
    ["no file type", { method: "POST", headers: headers({ "x-file-type": undefined }) }, 400, "bad_request"],
    ["a declared length over 25 MB", { method: "POST", headers: headers({ "content-length": String(25 * 1024 * 1024 + 1) }) }, 413, "too_large"],
  ])("refuses %s", async (_label, req, status, code) => {
    const res = await handleConsume({ ...req, body: body(new Uint8Array([1])) } as never);
    expect(res.status).toBe(status);
    expect((res.body as { code: string }).code).toBe(code);
  });

  it("refuses an empty body and a body over 25 MB, whatever the header said", async () => {
    const empty = await handleConsume({ method: "POST", headers: headers(), body: body() });
    expect(empty.status).toBe(400);
    const big = new Uint8Array(1024 * 1024);
    const chunks = Array.from({ length: 26 }, () => big);
    const over = await handleConsume({ method: "POST", headers: headers(), body: body(...chunks) });
    expect(over.status).toBe(413);
  });

  it("serves drive_upload_file only, and an ordinary tool name is not reachable through it", async () => {
    for (const name of ["drive_search", "gmail_save_attachment_to_drive", "gws_run"]) {
      const res = await handleConsume({ method: "POST", headers: headers({ "x-tool-name": name }), body: body(new Uint8Array([1])) });
      expect(res.status, name).toBe(404);
    }
  });
});
