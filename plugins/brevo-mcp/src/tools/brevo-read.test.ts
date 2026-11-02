import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrevoClient } from "../brevo-client.js";
import { brevoReadTools, handleBrevoRead } from "./brevo-read.js";

const request = vi.fn();
const client = { request } as unknown as BrevoClient;

beforeEach(() => request.mockReset());

function parsed(result: { content: Array<{ text: string }> }) {
  return JSON.parse(result.content[0].text);
}

describe("the read tools", () => {
  it("are eleven, each declared read-only and not destructive", () => {
    expect(brevoReadTools.map((t) => t.name).sort()).toEqual(
      ["account_get", "campaign_export_recipients", "campaign_get", "campaigns_list", "contact_get", "contacts_search", "email_log", "email_stats", "lists_get", "process_get", "templates_get"]
    );
    for (const t of brevoReadTools) {
      expect(t.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(t.inputSchema.additionalProperties).toBe(false);
      expect(t.description).not.toMatch(/[–—]/);
    }
  });

  it("contacts_search lists a list's members on its own path, and caps the page at 100", async () => {
    request.mockResolvedValue({ contacts: [] });
    await handleBrevoRead(client, "contacts_search", { list_id: 4, limit: 100 });
    expect(request).toHaveBeenCalledWith("GET", "/contacts/lists/{listId}/contacts", { params: { listId: 4 }, query: { limit: 100, offset: 0, modifiedSince: undefined } });
    await expect(handleBrevoRead(client, "contacts_search", { limit: 101 })).rejects.toThrow(/limit must be a whole number from 1 to 100/);
    await expect(handleBrevoRead(client, "contacts_search", { list_id: 4, filter: "equals(A,\"b\")" })).rejects.toThrow(/do not go with list_id/);
  });

  it("contact_get leaves out the statistics unless asked", async () => {
    request.mockResolvedValue({ email: "a@example.com", statistics: { opened: [] } });
    expect(parsed(await handleBrevoRead(client, "contact_get", { identifier: "a@example.com" }))).toEqual({ email: "a@example.com" });
    request.mockResolvedValue({ email: "a@example.com", statistics: { opened: [] } });
    expect(parsed(await handleBrevoRead(client, "contact_get", { identifier: "a@example.com", include_stats: true })).statistics).toEqual({ opened: [] });
  });

  it("campaigns_list always asks Brevo to leave out the HTML", async () => {
    request.mockResolvedValue({ campaigns: [] });
    await handleBrevoRead(client, "campaigns_list", { status: "sent" });
    expect(request.mock.calls[0][2].query).toMatchObject({ excludeHtmlContent: true, status: "sent", limit: 50, offset: 0 });
  });

  it("campaign_get returns HTML only when asked, cut at the cap with a marker", async () => {
    request.mockResolvedValue({ id: 7, htmlContent: "<p>x</p>" });
    expect(parsed(await handleBrevoRead(client, "campaign_get", { campaign_id: 7 }))).toEqual({ id: 7 });
    expect(request.mock.calls[0][2].query.excludeHtmlContent).toBe(true);
    request.mockResolvedValue({ id: 7, htmlContent: "a".repeat(50) });
    const html = parsed(await handleBrevoRead(client, "campaign_get", { campaign_id: 7, include_html: true, max_html_chars: 10 })).htmlContent;
    expect(html).toMatch(/^a{10}\n…\[truncated 40 of 50 chars\]$/);
  });

  it("templates_get drops HTML from a list, and refuses include_html without an id", async () => {
    request.mockResolvedValue({ templates: [{ id: 1, htmlContent: "<p>big</p>" }] });
    expect(parsed(await handleBrevoRead(client, "templates_get", {}))).toEqual({ templates: [{ id: 1 }] });
    await expect(handleBrevoRead(client, "templates_get", { include_html: true })).rejects.toThrow(/needs a template_id/);
  });

  it("campaign_export_recipients answers with the process id to follow", async () => {
    request.mockResolvedValue({ processId: 99 });
    const out = parsed(await handleBrevoRead(client, "campaign_export_recipients", { campaign_id: 7, recipients_type: "openers" }));
    expect(out.process_id).toBe(99);
    expect(request).toHaveBeenCalledWith("POST", "/emailCampaigns/{campaignId}/exportRecipients", { params: { campaignId: 7 }, body: { recipientsType: "openers" } });
  });

  it("email_log caps the page at 100, newest first, and checks the date range", async () => {
    request.mockResolvedValue({ events: [] });
    await handleBrevoRead(client, "email_log", { email: "a@example.com", event: "opened" });
    expect(request.mock.calls[0][2].query).toMatchObject({ email: "a@example.com", event: "opened", limit: 50, sort: "desc" });
    await expect(handleBrevoRead(client, "email_log", { days: 3, start_date: "2026-11-01", end_date: "2026-11-02" })).rejects.toThrow(/not both/);
    await expect(handleBrevoRead(client, "email_log", { start_date: "2026-11-01" })).rejects.toThrow(/go together/);
  });
});
