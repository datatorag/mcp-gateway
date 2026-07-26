import { describe, expect, it } from "vitest";

import { serviceFromSlug, serviceFromToolName } from "./service-icon";

describe("serviceFromToolName", () => {
  it("derives the service from a namespaced tool name", () => {
    expect(serviceFromToolName("gws-mcp__gmail_search")).toBe("gmail");
    expect(serviceFromToolName("gws-mcp__calendar_list_events")).toBe("calendar");
    expect(serviceFromToolName("atlassian-mcp__jira_create_issue")).toBe("jira");
    expect(serviceFromToolName("atlassian-mcp__confluence_get_page")).toBe("confluence");
  });

  it("derives the service from a bare tool name", () => {
    expect(serviceFromToolName("gmail_search")).toBe("gmail");
    expect(serviceFromToolName("sheets_read")).toBe("sheets");
  });

  it("returns null for tools without a service prefix", () => {
    expect(serviceFromToolName("gws-mcp__gws_run")).toBeNull();
    expect(serviceFromToolName("gws-mcp__gws_auth_setup")).toBeNull();
    expect(serviceFromToolName("echo")).toBeNull();
    expect(serviceFromToolName("")).toBeNull();
  });
});

describe("serviceFromSlug", () => {
  it("recognises service doc slugs", () => {
    for (const slug of [
      "gmail", "drive", "calendar", "docs", "sheets",
      "slides", "contacts", "tasks", "jira", "confluence",
    ]) {
      expect(serviceFromSlug(slug)).toBe(slug);
    }
  });

  it("returns null for non-service slugs", () => {
    expect(serviceFromSlug("getting-started")).toBeNull();
    expect(serviceFromSlug("google-workspace")).toBeNull();
    expect(serviceFromSlug("atlassian")).toBeNull();
    expect(serviceFromSlug("usage")).toBeNull();
  });
});
