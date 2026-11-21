import { describe, expect, it } from "vitest";
import { PUBLIC_CLIENTS_TEXT, PUBLIC_CONNECTORS_TEXT, PUBLIC_SERVICES, PUBLIC_SERVICES_TEXT } from "./public-integrations";

/* The public integration list is written once. These pin what it says
 * today, so a change to the connector or client lists is a reviewed change
 * to every page that reads them. */
describe("the public integration list", () => {
  it("names the three public connectors and nothing admin-only", () => {
    expect(PUBLIC_CONNECTORS_TEXT).toBe("Google Workspace, Atlassian, and Notion");
    for (const admin of ["Brevo", "Slack", "PostHog"]) {
      expect(PUBLIC_CONNECTORS_TEXT).not.toContain(admin);
      expect(PUBLIC_SERVICES_TEXT).not.toContain(admin);
    }
  });

  it("names every public service", () => {
    expect(PUBLIC_SERVICES_TEXT).toBe(
      "Gmail, Calendar, Drive, Docs, Sheets, Slides, Contacts, and Tasks, plus Jira, Confluence, and Notion"
    );
  });

  it("lists the same services one by one, for a page that draws them", () => {
    expect(PUBLIC_SERVICES).toEqual([
      "Gmail", "Calendar", "Drive", "Docs", "Sheets", "Slides", "Contacts", "Tasks", "Jira", "Confluence", "Notion",
    ]);
  });

  it("names the clients the dashboard has steps for", () => {
    expect(PUBLIC_CLIENTS_TEXT).toBe("Claude, ChatGPT, Codex, and Cursor");
  });
});
