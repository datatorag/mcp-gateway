import { describe, expect, it } from "vitest";
import { METHOD_TABLE } from "../google-api/method-table.js";
import { fakeClient } from "./fake-client.test-helper.js";
import { handleGeneric } from "./generic.js";
import { allTools } from "./index.js";
import { NAMED_TOOL_FOR, namedToolLine } from "./named-tool-hints.js";
import { withAliased } from "./response.js";

/* SCRUM-499. A raw gws_run call a named tool covers answers with one leading
 * line naming that tool; the call still runs and its answer follows. */

describe("the map cannot drift from the registered tools", () => {
  const registered = new Set(allTools.map((t) => t.name));

  it.each(Object.entries(NAMED_TOOL_FOR))("%s names a registered tool other than gws_run", (_key, entry) => {
    expect(registered.has(entry.tool)).toBe(true);
    expect(entry.tool).not.toBe("gws_run");
  });

  it.each(Object.keys(NAMED_TOOL_FOR))("%s is a method in the method table", (key) => {
    const [service, path] = key.split(" ");
    expect(METHOD_TABLE[service]?.methods[path]).toBeDefined();
  });

  it.each(Object.entries(NAMED_TOOL_FOR))("%s lists a body only for a method that takes one", (key, entry) => {
    const [service, path] = key.split(" ");
    const takesBody = METHOD_TABLE[service].methods[path].hasBody === true;
    if (entry.body) expect(takesBody).toBe(true);
  });

  it("covers the three pairs the ticket names", () => {
    expect(NAMED_TOOL_FOR["gmail users.threads.get"].tool).toBe("gmail_read_thread");
    expect(NAMED_TOOL_FOR["gmail users.messages.get"].tool).toBe("gmail_read");
    expect(NAMED_TOOL_FOR["drive files.copy"].tool).toBe("drive_copy_file");
  });
});

describe("namedToolLine: only when the named tool can do what was asked", () => {
  it("a thread read with format, id, userId, and fields names gmail_read_thread", () => {
    expect(
      namedToolLine("gmail", "users.threads", "get", { userId: "me", id: "t1", format: "full", fields: "messages(id)" }, undefined)
    ).toBe(
      "gmail_read_thread covers this call: every message of the conversation in one call, a body budget that keeps the newest messages, and a headers-only mode."
    );
  });

  it("a raw-format thread read says nothing: the named tool has no raw view", () => {
    expect(namedToolLine("gmail", "users.threads", "get", { userId: "me", id: "t1", format: "raw" }, undefined)).toBeUndefined();
  });

  it("another mailbox's userId says nothing: the named tool reads the connected account only", () => {
    expect(namedToolLine("gmail", "users.threads", "get", { userId: "other@example.com", id: "t1" }, undefined)).toBeUndefined();
  });

  it("a copy with a target type, an OCR language, and a parent folder names drive_copy_file", () => {
    const params = {
      fileId: "f1",
      mimeType: "application/vnd.google-apps.document",
      name: "Scan",
      ocrLanguage: "en",
      parents: ["folder1"],
    };
    expect(namedToolLine("drive", "files", "copy", params, undefined)).toMatch(/^drive_copy_file covers this call: /);
    expect(
      namedToolLine("drive", "files", "copy", { fileId: "f1" }, { name: "Scan", mimeType: "application/vnd.google-apps.document", parents: ["f"] })
    ).toMatch(/^drive_copy_file /);
  });

  it("a copy with two parents, no name, or a field the named tool lacks says nothing", () => {
    expect(namedToolLine("drive", "files", "copy", { fileId: "f1", name: "x", parents: ["a", "b"] }, undefined)).toBeUndefined();
    expect(namedToolLine("drive", "files", "copy", { fileId: "f1" }, undefined)).toBeUndefined();
    expect(namedToolLine("drive", "files", "copy", { fileId: "f1" }, { name: "x", description: "d" })).toBeUndefined();
    expect(namedToolLine("drive", "files", "copy", { fileId: "f1", name: "x", keepRevisionForever: true }, undefined)).toBeUndefined();
  });

  it("a body on a method whose named tool takes none says nothing", () => {
    expect(namedToolLine("gmail", "users.messages", "get", { userId: "me", id: "m" }, { x: 1 })).toBeUndefined();
  });

  it("a method with no named tool says nothing", () => {
    expect(namedToolLine("gmail", "users.threads", "list", { userId: "me" }, undefined)).toBeUndefined();
    expect(namedToolLine("drive", "about", "get", { fields: "user" }, undefined)).toBeUndefined();
  });
});

describe("gws_run: the line leads, the answer follows unchanged", () => {
  it("a covered call answers the line, then the API's own JSON", async () => {
    const thread = { id: "t1", messages: [{ id: "m1" }] };
    const { client, calls } = fakeClient([{ data: thread }]);
    const out = await handleGeneric(client, "gws_run", {
      service: "gmail",
      resource: "users.threads",
      method: "get",
      params: { userId: "me", id: "t1", format: "full" },
    });
    expect(calls).toHaveLength(1);
    expect(out.content).toHaveLength(2);
    expect(out.content[0].text).toMatch(/^gmail_read_thread covers this call: /);
    expect(JSON.parse(out.content[1].text)).toEqual(thread);
  });

  it("an uncovered call answers exactly as before, with no line", async () => {
    const { client } = fakeClient([{ data: { threads: [] } }]);
    const out = await handleGeneric(client, "gws_run", {
      service: "gmail",
      resource: "users.threads",
      method: "list",
      params: { userId: "me" },
    });
    expect(out.content).toHaveLength(1);
    expect(JSON.parse(out.content[0].text)).toEqual({ threads: [] });
  });

  it("an alias note still merges into the JSON answer after the line", () => {
    const answer = {
      content: [
        { type: "text", text: "slides_batch_update covers this call: x." },
        { type: "text", text: JSON.stringify({ ok: true }) },
      ],
    };
    const out = withAliased(answer, { body: "json_body" });
    expect(out.content).toHaveLength(2);
    expect(out.content[0].text).toBe("slides_batch_update covers this call: x.");
    expect(JSON.parse(out.content[1].text!)).toEqual({ ok: true, aliased: { body: "json_body" } });
  });
});
