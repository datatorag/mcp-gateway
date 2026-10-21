import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { serviceFromSlug, serviceFromToolName } from "./service-icon";

const ICON_DIR = join(import.meta.dirname, "../../public/icons/services");

describe("serviceFromToolName", () => {
  it("derives the service from a namespaced tool name", () => {
    expect(serviceFromToolName("gws-mcp__gmail_search")).toBe("gmail");
    expect(serviceFromToolName("gws-mcp__calendar_list_events")).toBe("calendar");
    expect(serviceFromToolName("atlassian-mcp__jira_create_issue")).toBe("jira");
    expect(serviceFromToolName("atlassian-mcp__confluence_get_page")).toBe("confluence");
    expect(serviceFromToolName("notion-mcp__notion_search")).toBe("notion");
  });

  it("derives the service from a bare tool name", () => {
    expect(serviceFromToolName("gmail_search")).toBe("gmail");
    expect(serviceFromToolName("sheets_read")).toBe("sheets");
    expect(serviceFromToolName("notion_get_page")).toBe("notion");
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
      "slides", "contacts", "tasks", "jira", "confluence", "notion",
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

/* SCRUM-366: a service the component knows has its asset beside the others
 * and a provenance line in SOURCES.md. */
describe("the Notion mark", () => {
  it("is self-hosted, carries no script, and is listed in SOURCES.md with its source", () => {
    const svg = readFileSync(join(ICON_DIR, "notion.svg"), "utf8");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toMatch(/<script|on\w+=|href=/i);
    const sources = readFileSync(join(ICON_DIR, "SOURCES.md"), "utf8");
    expect(sources).toMatch(/\| notion\.svg \| File:Notion-logo\.svg \(https:\/\/commons\.wikimedia\.org\//);
  });
});
