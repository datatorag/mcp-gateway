import { describe, expect, it } from "vitest";
import { INTROSPECTION_TOOL_NAMES } from "../../mastra/tools/introspection";
import {
  INTERNAL_TOOL_DISPLAY,
  internalToolIcon,
  toolDisplayName,
} from "./agent-tool-copy";

describe("agent tool display names", () => {
  it("covers exactly the gateway's internal tools, no more and no less", () => {
    // Compared against INTROSPECTION_TOOL_NAMES, the list the agent wiring
    // itself consumes — ground truth, not a hand-copied enumeration that
    // could drift with it. Both directions matter and enforce different
    // rules: a MISSING key means a new internal tool ships showing its raw
    // id, which is the defect this module exists to close; an EXTRA key
    // means something other than an internal tool gained a friendly alias,
    // and connector tools keep their literal names BY RULING - a user
    // auditing what the agent touched needs the precise name, and that
    // auditability is a public product claim. Adding a connector entry here
    // is therefore a decision to overturn, not a mapping to extend.
    expect(Object.keys(INTERNAL_TOOL_DISPLAY).sort()).toEqual(
      [...INTROSPECTION_TOOL_NAMES].sort()
    );
  });

  it("labels are human sentences, not identifiers", () => {
    for (const [id, entry] of Object.entries(INTERNAL_TOOL_DISPLAY)) {
      // The label must actually replace the id, not restyle it.
      expect(entry.label).not.toBe(id);
      expect(entry.label).not.toContain("_");
      // House rules that apply to every user-facing string on this surface.
      expect(entry.label).not.toContain("—");
      expect(entry.label.toLowerCase()).not.toContain("playground");
      // Every entry carries its glyph; a label without one would regress to
      // the generic wrench the entry exists to replace.
      expect(entry.icon).toBeTruthy();
    }
  });

  it("falls back to the LITERAL name for anything unmapped", () => {
    // The fallback is the feature: connector tool names pass through exact,
    // and an unknown future tool degrades to its true id rather than to a
    // wrong or empty label.
    expect(toolDisplayName("gmail_search")).toBe("gmail_search");
    expect(toolDisplayName("jira_create_issue")).toBe("jira_create_issue");
    expect(internalToolIcon("gmail_search")).toBeNull();
  });

  it("maps the two names the ticket was filed about", () => {
    // The observed defect, pinned: these two raw ids were the first things a
    // new user saw after their first message. If either lookup starts
    // returning the id again, the regression is exactly the filed bug.
    expect(toolDisplayName("account_status")).not.toBe("account_status");
    expect(toolDisplayName("request_connection")).not.toBe(
      "request_connection"
    );
  });
});
