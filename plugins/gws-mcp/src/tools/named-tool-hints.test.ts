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

  it("handles the three pairs the ticket names", () => {
    expect(NAMED_TOOL_FOR["gmail users.threads.get"].tool).toBe("gmail_read_thread");
    expect(NAMED_TOOL_FOR["gmail users.messages.get"].tool).toBe("gmail_read");
    expect(NAMED_TOOL_FOR["drive files.copy"].tool).toBe("drive_copy_file");
  });
});

describe("namedToolLine: only when the named tool returns what the raw call asked for", () => {
  it("a thread read is answered with what gmail_read_thread returns, not a claim that it covers the call", () => {
    const line = namedToolLine("gmail", "users.threads", "get", { userId: "me", id: "t1", format: "full", fields: "messages(id)" }, undefined);
    expect(line).toMatch(/^gmail_read_thread reads this thread in one call: /);
    expect(line).toContain("It does not return other headers or the HTML part.");
    expect(line).not.toContain("covers");
    expect(
      namedToolLine("gmail", "users.threads", "get", { userId: "me", id: "t1", format: "metadata", metadataHeaders: ["Message-ID"] }, undefined)
    ).toMatch(/^gmail_read_thread reads this thread/);
  });

  it("a raw-format thread read, or another mailbox, says nothing", () => {
    expect(namedToolLine("gmail", "users.threads", "get", { userId: "me", id: "t1", format: "raw" }, undefined)).toBeUndefined();
    expect(namedToolLine("gmail", "users.threads", "get", { userId: "other@example.com", id: "t1" }, undefined)).toBeUndefined();
  });

  it("a copy with a target type, an OCR language, and a parent folder names drive_copy_file", () => {
    const params = { fileId: "f1", mimeType: "application/vnd.google-apps.document", name: "Scan", ocrLanguage: "en", parents: ["folder1"] };
    expect(namedToolLine("drive", "files", "copy", params, undefined)).toMatch(/^drive_copy_file covers this call: /);
    expect(
      namedToolLine("drive", "files", "copy", { fileId: "f1" }, { name: "Scan", mimeType: "application/vnd.google-apps.document", parents: ["f"] })
    ).toMatch(/^drive_copy_file /);
  });

  it("a copy with two parents, no name, a field the tool lacks, or a field mask says nothing", () => {
    expect(namedToolLine("drive", "files", "copy", { fileId: "f1", name: "x", parents: ["a", "b"] }, undefined)).toBeUndefined();
    expect(namedToolLine("drive", "files", "copy", { fileId: "f1" }, undefined)).toBeUndefined();
    expect(namedToolLine("drive", "files", "copy", { fileId: "f1" }, { name: "x", description: "d" })).toBeUndefined();
    expect(namedToolLine("drive", "files", "copy", { fileId: "f1", name: "x", fields: "id,md5Checksum" }, undefined)).toBeUndefined();
  });

  it("a field mask says nothing where the named tool returns a fixed set of fields", () => {
    expect(namedToolLine("drive", "files", "list", { q: "x", fields: "files(id,owners)" }, undefined)).toBeUndefined();
    expect(namedToolLine("drive", "files", "list", { q: "x" }, undefined)).toMatch(/^drive_search /);
  });

  it("a call that asks for every page says nothing", () => {
    expect(namedToolLine("gmail", "users.messages", "list", { userId: "me", q: "x", maxResults: 10 }, undefined, true)).toBeUndefined();
    expect(namedToolLine("drive", "files", "list", { q: "x" }, undefined, true)).toBeUndefined();
    expect(namedToolLine("gmail", "users.messages", "list", { userId: "me", q: "x", maxResults: 10 }, undefined, false)).toMatch(
      /^gmail_search /
    );
  });

  it("a large listing, which gmail_search would read one message at a time, says nothing", () => {
    expect(namedToolLine("gmail", "users.messages", "list", { userId: "me", q: "x", maxResults: 500 }, undefined)).toBeUndefined();
    expect(namedToolLine("gmail", "users.messages", "list", { userId: "me", q: "x" }, undefined)).toBeUndefined();
  });

  it("an event listing says nothing unless it expands recurring events over a stated window, as the tool does", () => {
    expect(namedToolLine("calendar", "events", "list", { calendarId: "primary", timeMin: "2026-01-01T00:00:00Z" }, undefined)).toBeUndefined();
    const window = { calendarId: "primary", timeMin: "2026-01-01T00:00:00Z", timeMax: "2026-01-08T00:00:00Z", maxResults: 20 };
    expect(namedToolLine("calendar", "events", "list", { ...window, singleEvents: false }, undefined)).toBeUndefined();
    expect(namedToolLine("calendar", "events", "list", { ...window, singleEvents: true }, undefined)).toMatch(/^calendar_list_events /);
  });

  it("a contacts call says nothing when it asks for fields the contacts tools do not request", () => {
    expect(namedToolLine("people", "people", "get", { resourceName: "people/c1", personFields: "addresses,birthdays" }, undefined)).toBeUndefined();
    expect(namedToolLine("people", "people", "get", { resourceName: "people/c1", personFields: "names,emailAddresses" }, undefined)).toMatch(
      /^contacts_get /
    );
    expect(
      namedToolLine("people", "people", "searchDirectoryPeople", { query: "a", readMask: "names", sources: "DIRECTORY_SOURCE_TYPE_DOMAIN_CONTACT" }, undefined)
    ).toBeUndefined();
  });

  it("a presentation read says nothing: slides_get answers an outline, not the presentation", () => {
    expect(namedToolLine("slides", "presentations", "get", { presentationId: "p" }, undefined)).toBeUndefined();
  });

  it("an empty body is no body", () => {
    expect(namedToolLine("sheets", "spreadsheets.values", "clear", { spreadsheetId: "s", range: "A1:B2" }, {})).toMatch(/^sheets_clear /);
    expect(namedToolLine("gmail", "users.messages", "trash", { userId: "me", id: "m" }, {})).toMatch(/^gmail_trash /);
    expect(namedToolLine("gmail", "users.messages", "get", { userId: "me", id: "m" }, { x: 1 })).toBeUndefined();
  });

  it("a parameter named like an object's own members is a parameter, and never throws", () => {
    for (const key of ["constructor", "toString", "valueOf", "hasOwnProperty"]) {
      expect(() => namedToolLine("drive", "files", "copy", { fileId: "F", name: "x", [key]: "y" }, undefined)).not.toThrow();
      expect(namedToolLine("drive", "files", "copy", { fileId: "F", name: "x", [key]: "y" }, undefined)).toBeUndefined();
    }
    const proto = JSON.parse('{"fileId":"F","name":"x","__proto__":{"a":1}}') as Record<string, unknown>;
    expect(namedToolLine("drive", "files", "copy", proto, undefined)).toBeUndefined();
    expect(namedToolLine("drive", "files", "copy", { fileId: "F" }, JSON.parse('{"name":"x","constructor":1}'))).toBeUndefined();
    expect(namedToolLine("gmail", "users", "constructor", {}, undefined)).toBeUndefined();
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
    expect(out.content[0].text).toMatch(/^gmail_read_thread reads this thread in one call: /);
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
