import { describe, expect, it } from "vitest";
import { listOf, PUBLIC_CLIENTS_TEXT, PUBLIC_CONNECTORS_TEXT, PUBLIC_SERVICES_TEXT } from "./public-integrations";

/* The public integration list is written once. These pin what it says
 * today, so a change to the connector or client lists is a reviewed change
 * to every page that reads them. */
describe("the public integration list", () => {
  it("names the three public connectors and nothing admin-only", () => {
    expect(PUBLIC_CONNECTORS_TEXT).toBe("Google Workspace, Atlassian and Notion");
    for (const admin of ["Brevo", "Slack", "PostHog"]) {
      expect(PUBLIC_CONNECTORS_TEXT).not.toContain(admin);
      expect(PUBLIC_SERVICES_TEXT).not.toContain(admin);
    }
  });

  it("names every public service", () => {
    expect(PUBLIC_SERVICES_TEXT).toBe(
      "Gmail, Calendar, Drive, Docs, Sheets, Slides, Contacts and Tasks, plus Jira, Confluence and Notion"
    );
  });

  it("names the clients the dashboard has steps for", () => {
    expect(PUBLIC_CLIENTS_TEXT).toBe("Claude, ChatGPT, Codex and Cursor");
  });

  it("joins a list the way the pages write one", () => {
    expect(listOf([])).toBe("");
    expect(listOf(["a"])).toBe("a");
    expect(listOf(["a", "b"])).toBe("a and b");
    expect(listOf(["a", "b", "c"])).toBe("a, b and c");
  });
});
