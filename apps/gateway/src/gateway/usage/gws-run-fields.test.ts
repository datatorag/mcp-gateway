import { describe, expect, it } from "vitest";
import { gwsRunFields } from "./gws-run-fields";

const NONE = { service: null, resource: null, method: null };

/* SCRUM-227, SCRUM-419: which raw API call a gws_run was, said as three short
 * names and nothing else. Arguments, bodies and query params never leave the
 * call. */
describe("gwsRunFields", () => {
  it("reads service, resource and method off a gws_run call, namespaced or bare", () => {
    expect(gwsRunFields("gws-mcp__gws_run", { service: "calendar", resource: "events", method: "list", params: { q: "x" } }))
      .toEqual({ service: "calendar", resource: "events", method: "list" });
    expect(gwsRunFields("gws_run", { service: "drive", resource: "files", method: "get" }))
      .toEqual({ service: "drive", resource: "files", method: "get" });
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

  it("carries only the three names: params, body and every other argument stay behind", () => {
    const fields = gwsRunFields("gws-mcp__gws_run", {
      service: "gmail",
      resource: "users.messages",
      method: "get",
      params: { userId: "me", id: "message-id-in-params" },
      body: { raw: "body-content" },
      account: "someone@example.com",
    });
    expect(Object.keys(fields).sort()).toEqual(["method", "resource", "service"]);
    const text = JSON.stringify(fields);
    for (const leaked of ["message-id-in-params", "body-content", "someone@example.com", "userId"]) {
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
      .toEqual({ service: null, resource: "files", method: "list" });
    expect(gwsRunFields("gws-mcp__gws_run", { service: "drive", resource: "a.".repeat(40), method: "list" }))
      .toEqual({ service: "drive", resource: null, method: "list" });
    expect(gwsRunFields("gws-mcp__gws_run", undefined)).toEqual(NONE);
  });

  it("each name is judged on its own: one bad name does not blank the others", () => {
    expect(gwsRunFields("gws-mcp__gws_run", { service: "gmail", resource: "users/me/messages/abc123", method: "get" }))
      .toEqual({ service: "gmail", resource: null, method: "get" });
  });

  it("accepts only name characters, so a dashboard dimension stays clean", () => {
    expect(gwsRunFields("gws-mcp__gws_run", { service: "drive", resource: "files", method: "files.list" }))
      .toEqual({ service: "drive", resource: "files", method: "files.list" });
    expect(gwsRunFields("gws-mcp__gws_run", { service: "spreadsheets.values", resource: "spreadsheets.values", method: "batch-get_v4" }))
      .toEqual({ service: "spreadsheets.values", resource: "spreadsheets.values", method: "batch-get_v4" });
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
});
