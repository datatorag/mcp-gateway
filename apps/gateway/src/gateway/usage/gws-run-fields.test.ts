import { describe, expect, it } from "vitest";
import { gwsRunFields } from "./gws-run-fields";

/* SCRUM-227: which raw API call a gws_run was, said as two short names and
 * nothing else. Arguments, bodies and query params never leave the call. */
describe("gwsRunFields", () => {
  it("reads service and method off a gws_run call, namespaced or bare", () => {
    expect(gwsRunFields("gws-mcp__gws_run", { service: "calendar", resource: "events", method: "list", params: { q: "x" } }))
      .toEqual({ service: "calendar", method: "list" });
    expect(gwsRunFields("gws_run", { service: "drive", method: "get" })).toEqual({ service: "drive", method: "get" });
  });

  it("is null for any other tool, whatever its arguments say", () => {
    expect(gwsRunFields("gws-mcp__gmail_search", { service: "gmail", method: "list" })).toEqual({ service: null, method: null });
  });

  it("never carries anything but a short string: missing, non-string or long values become null", () => {
    expect(gwsRunFields("gws-mcp__gws_run", {})).toEqual({ service: null, method: null });
    expect(gwsRunFields("gws-mcp__gws_run", { service: { nested: true }, method: 3 })).toEqual({ service: null, method: null });
    expect(gwsRunFields("gws-mcp__gws_run", { service: "x".repeat(200), method: "list" })).toEqual({ service: null, method: "list" });
    expect(gwsRunFields("gws-mcp__gws_run", undefined)).toEqual({ service: null, method: null });
  });

  it("accepts only name characters, so a dashboard dimension stays clean", () => {
    expect(gwsRunFields("gws-mcp__gws_run", { service: "drive", method: "files.list" })).toEqual({ service: "drive", method: "files.list" });
    expect(gwsRunFields("gws-mcp__gws_run", { service: "spreadsheets.values", method: "batch-get_v4" })).toEqual({ service: "spreadsheets.values", method: "batch-get_v4" });
    expect(gwsRunFields("gws-mcp__gws_run", { service: "drive\\nBcc: x", method: "list;drop" })).toEqual({ service: null, method: null });
    expect(gwsRunFields("gws-mcp__gws_run", { service: "", method: " list" })).toEqual({ service: null, method: null });
  });
});
