import { describe, expect, it } from "vitest";
import { gwsRunFields } from "./gws-run-fields";

const NONE = { service: null, resource: null, method: null, paramNames: null };

/* SCRUM-227, SCRUM-419: which raw API call a gws_run was, said as three short
 * names and nothing else. Arguments, bodies and query params never leave the
 * call. */
describe("gwsRunFields", () => {
  it("reads service, resource and method off a gws_run call, namespaced or bare", () => {
    expect(gwsRunFields("gws-mcp__gws_run", { service: "calendar", resource: "events", method: "list", params: { q: "x" } }))
      .toEqual({ service: "calendar", resource: "events", method: "list", paramNames: "q" });
    expect(gwsRunFields("gws_run", { service: "drive", resource: "files", method: "get" }))
      .toEqual({ service: "drive", resource: "files", method: "get", paramNames: null });
  });

  it("the resource is what tells two calls with one service and method apart (SCRUM-419)", () => {
    // The reason the third name exists. Both pairs below were one row shape
    // before it: gmail/get and calendar/list.
    const message = gwsRunFields("gws-mcp__gws_run", { service: "gmail", resource: "users.messages", method: "get" });
    const attachment = gwsRunFields("gws-mcp__gws_run", { service: "gmail", resource: "users.messages.attachments", method: "get" });
    expect(message.resource).toBe("users.messages");
    expect(attachment.resource).toBe("users.messages.attachments");
    expect({ ...message, resource: null }).toEqual({ ...attachment, resource: null });

    expect(gwsRunFields("gws-mcp__gws_run", { service: "calendar", resource: "calendarList", method: "list" }).resource).toBe("calendarList");
    expect(gwsRunFields("gws-mcp__gws_run", { service: "sheets", resource: "spreadsheets.values", method: "get" }).resource).toBe("spreadsheets.values");
  });

  it("carries only names: no param value, body value or other argument leaves the call", () => {
    const fields = gwsRunFields("gws-mcp__gws_run", {
      service: "gmail",
      resource: "users.messages",
      method: "get",
      params: { userId: "me", id: "message-id-in-params" },
      body: { raw: "body-content" },
      account: "someone@example.com",
    });
    expect(Object.keys(fields).sort()).toEqual(["method", "paramNames", "resource", "service"]);
    expect(fields.paramNames).toBe("id,raw,userId");
    const text = JSON.stringify(fields);
    for (const leaked of ["message-id-in-params", "body-content", "someone@example.com", "account"]) {
      expect(text).not.toContain(leaked);
    }
  });

  it("is null for any other tool, whatever its arguments say", () => {
    expect(gwsRunFields("gws-mcp__gmail_search", { service: "gmail", resource: "users.messages", method: "list" })).toEqual(NONE);
  });

  it("never carries anything but a short string: missing, non-string or long values become null", () => {
    expect(gwsRunFields("gws-mcp__gws_run", {})).toEqual(NONE);
    expect(gwsRunFields("gws-mcp__gws_run", { service: { nested: true }, resource: ["users", "messages"], method: 3 })).toEqual(NONE);
    expect(gwsRunFields("gws-mcp__gws_run", { service: "x".repeat(200), resource: "files", method: "list" }))
      .toEqual({ service: null, resource: "files", method: "list", paramNames: null });
    expect(gwsRunFields("gws-mcp__gws_run", { service: "drive", resource: "a.".repeat(40), method: "list" }))
      .toEqual({ service: "drive", resource: null, method: "list", paramNames: null });
    expect(gwsRunFields("gws-mcp__gws_run", undefined)).toEqual(NONE);
  });

  it("each name is judged on its own: one bad name does not blank the others", () => {
    expect(gwsRunFields("gws-mcp__gws_run", { service: "gmail", resource: "users/me/messages/abc123", method: "get" }))
      .toEqual({ service: "gmail", resource: null, method: "get", paramNames: null });
  });

  it("accepts only name characters, so a dashboard dimension stays clean", () => {
    expect(gwsRunFields("gws-mcp__gws_run", { service: "drive", resource: "files", method: "files.list" }))
      .toEqual({ service: "drive", resource: "files", method: "files.list", paramNames: null });
    expect(gwsRunFields("gws-mcp__gws_run", { service: "spreadsheets.values", resource: "spreadsheets.values", method: "batch-get_v4" }))
      .toEqual({ service: "spreadsheets.values", resource: "spreadsheets.values", method: "batch-get_v4", paramNames: null });
  });

  it("a resource is letters in dotted segments, so an id typed there by mistake is not recorded", () => {
    const resource = (value: unknown) => gwsRunFields("gws-mcp__gws_run", { service: "drive", resource: value, method: "get" }).resource;
    for (const real of ["files", "calendarList", "users.messages.attachments", "spreadsheets.values", "spreadsheets.developerMetadata"]) {
      expect(resource(real), real).toBe(real);
    }
    // The shapes an id or a key has: a digit, a hyphen or an underscore.
    for (const id of ["18c2f0a9b1d4e7f3", "1AbC-dEf_GhIjKlMnOpQrStUvWxYz0123456789abcdE", "files.18c2f0a9", "users.me_1", "a-b", ".files", "files.", "a..b"]) {
      expect(resource(id), id).toBeNull();
    }
    expect(gwsRunFields("gws-mcp__gws_run", { service: "drive\\nBcc: x", resource: "files?fields=*", method: "list;drop" })).toEqual(NONE);
    expect(gwsRunFields("gws-mcp__gws_run", { service: "", resource: "users messages", method: " list" })).toEqual(NONE);
    // A path with an id or an address in it is not a resource name.
    expect(gwsRunFields("gws-mcp__gws_run", { service: "gmail", resource: "users/someone@example.com", method: "get" }).resource).toBeNull();
  });

  /* SCRUM-419: the parameter names. Keys only; the extractor never reads a
   * value, and a key that is not shaped like a parameter name is dropped. */
  describe("paramNames", () => {
    const names = (args: Record<string, unknown>) =>
      gwsRunFields("gws-mcp__gws_run", { service: "calendar", resource: "events", method: "list", ...args }).paramNames;

    it("lists the keys of params and of the body, sorted, deduplicated and comma-joined", () => {
      expect(names({ params: { timeMin: "2026-10-16T00:00:00Z", calendarId: "primary", singleEvents: true, maxResults: 50 } }))
        .toBe("calendarId,maxResults,singleEvents,timeMin");
      expect(names({ params: { spreadsheetId: "1AbC", range: "A1" }, json_body: { values: [[1]], range: "A1" } }))
        .toBe("range,spreadsheetId,values");
      // The body the plugin sends: json_body when given, body otherwise.
      expect(names({ body: { removeLabelIds: ["UNREAD"] } })).toBe("removeLabelIds");
      expect(names({ json_body: { summary: "x" }, body: { ignored: "x" } })).toBe("summary");
    });

    it("is null when no name survives, and for every other tool", () => {
      expect(names({})).toBeNull();
      expect(names({ params: {} })).toBeNull();
      expect(names({ params: "calendarId=primary", body: ["values"] })).toBeNull();
      expect(names({ params: null, json_body: 7 })).toBeNull();
      expect(gwsRunFields("gws-mcp__gmail_search", { params: { q: "x" } }).paramNames).toBeNull();
    });

    it("reads only the top level: nested keys are not names of the call's parameters", () => {
      expect(names({ json_body: { requests: [{ updateCells: { rows: [] } }], includeSpreadsheetInResponse: false } }))
        .toBe("includeSpreadsheetInResponse,requests");
    });

    it("drops a key that is not shaped like a parameter name or is longer than 32 characters", () => {
      expect(names({
        params: {
          calendarId: 1,
          "someone@example.com": 1,
          "1AbC-dEf_GhIjKl": 1,
          "18c2f0a9b1d4e7f3": 1,
          "has space": 1,
          "a.b": 1,
          "": 1,
          _private: 1,
          ["k".repeat(33)]: 1,
          ["k".repeat(32)]: 1,
        },
      })).toBe(`calendarId,${"k".repeat(32)}`);
    });

    it("caps the list at 24 names, the first 24 in sorted order", () => {
      const params = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${String(i).padStart(2, "0")}`, i]));
      const out = names({ params })!.split(",");
      expect(out).toHaveLength(24);
      expect(out[0]).toBe("p00");
      expect(out[23]).toBe("p23");
    });

    it("no value reaches the field, whatever it holds", () => {
      // Values chosen to pass every key rule, so only the key-versus-value
      // choice keeps them out. A control that read values instead of keys
      // (Object.values for Object.keys) was run and this test failed.
      const fields = gwsRunFields("gws-mcp__gws_run", {
        service: "gmail",
        resource: "users.messages",
        method: "list",
        params: { q: "secretQueryValue", userId: "me", labelIds: ["INBOX"] },
        json_body: { raw: "bodyValueShapedLikeAName", to: "personname" },
      });
      expect(fields.paramNames).toBe("labelIds,q,raw,to,userId");
      for (const value of ["secretQueryValue", "me", "INBOX", "bodyValueShapedLikeAName", "personname"]) {
        expect(fields.paramNames!.split(","), value).not.toContain(value);
      }
    });
  });
});
