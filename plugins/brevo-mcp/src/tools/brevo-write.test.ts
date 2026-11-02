import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrevoClient } from "../brevo-client.js";
import { brevoWriteTools, handleBrevoWrite } from "./brevo-write.js";

const request = vi.fn();
const client = { request } as unknown as BrevoClient;

beforeEach(() => request.mockReset());

/** The answers a campaign_send's checks read, in order. */
function sendAnswers(opts: { lists: Record<number, number>; sendLimit: number | null }) {
  request.mockImplementation(async (method: string, template: string, o: { params?: Record<string, number> }) => {
    if (method === "GET" && template === "/emailCampaigns/{campaignId}") return { recipients: { lists: Object.keys(opts.lists).map(Number) } };
    if (method === "GET" && template === "/contacts/lists/{listId}") return { totalSubscribers: opts.lists[o.params!.listId] };
    if (method === "GET" && template === "/account") {
      return { plan: [{ type: "free", creditsType: "sendLimit", credits: opts.sendLimit }].filter((p) => p.credits !== null) };
    }
    return {};
  });
}

describe("the write tools", () => {
  it("are nine; the three that send email are MUTATE and say a send cannot be recalled", () => {
    const byName = new Map(brevoWriteTools.map((t) => [t.name, t]));
    expect([...byName.keys()].sort()).toEqual(
      ["campaign_create", "campaign_send", "campaign_send_test", "campaign_set_status", "campaign_update", "contact_create", "contact_update", "email_send", "list_members_update"]
    );
    for (const name of ["campaign_send", "email_send", "campaign_send_test"]) {
      expect(byName.get(name)!.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: true });
      expect(byName.get(name)!.description).toMatch(/cannot be recalled/);
    }
    for (const t of brevoWriteTools) {
      if (!["campaign_send", "email_send", "campaign_send_test"].includes(t.name)) {
        expect(t.annotations).toMatchObject({ readOnlyHint: false, destructiveHint: false });
      }
      expect(t.description).not.toMatch(/[–—]/);
      expect(t.inputSchema.additionalProperties).toBe(false);
    }
  });

  it("campaign_send sends nothing when the limit left is below what the lists hold, and says both numbers", async () => {
    sendAnswers({ lists: { 1: 200, 2: 150 }, sendLimit: 300 });
    await expect(handleBrevoWrite(client, "campaign_send", { campaign_id: 7 })).rejects.toThrow(
      /Nothing was sent\. Campaign 7's lists hold up to 350 contacts, and the account can send 300 more emails today/
    );
    expect(request.mock.calls.some((c) => c[1] === "/emailCampaigns/{campaignId}/sendNow")).toBe(false);
  });

  it("campaign_send sends now when the limit covers the lists, or when the plan has no daily limit", async () => {
    sendAnswers({ lists: { 1: 20 }, sendLimit: 300 });
    const out = JSON.parse((await handleBrevoWrite(client, "campaign_send", { campaign_id: 7 })).content[0].text);
    expect(out).toEqual({ campaign_id: 7, sent: true, lists_hold_up_to: 20, send_limit_left_before: 300 });
    expect(request).toHaveBeenCalledWith("POST", "/emailCampaigns/{campaignId}/sendNow", { params: { campaignId: 7 } });
    request.mockReset();
    sendAnswers({ lists: { 1: 5000 }, sendLimit: null });
    await handleBrevoWrite(client, "campaign_send", { campaign_id: 7 });
    expect(request.mock.calls.some((c) => c[1] === "/emailCampaigns/{campaignId}/sendNow")).toBe(true);
  });

  it("campaign_send with scheduled_at schedules instead of sending now", async () => {
    sendAnswers({ lists: { 1: 20 }, sendLimit: 300 });
    await handleBrevoWrite(client, "campaign_send", { campaign_id: 7, scheduled_at: "2026-11-02T09:00:00Z" });
    expect(request).toHaveBeenCalledWith("PUT", "/emailCampaigns/{campaignId}", { params: { campaignId: 7 }, body: { scheduledAt: "2026-11-02T09:00:00Z" } });
    expect(request.mock.calls.some((c) => c[1] === "/emailCampaigns/{campaignId}/sendNow")).toBe(false);
  });

  it("campaign_update refuses to schedule, and needs something to change", async () => {
    await expect(handleBrevoWrite(client, "campaign_update", { campaign_id: 7, scheduled_at: "2026-11-02T09:00:00Z" })).rejects.toThrow(/use campaign_send/);
    await expect(handleBrevoWrite(client, "campaign_update", { campaign_id: 7 })).rejects.toThrow(/Nothing to change/);
    expect(request).not.toHaveBeenCalled();
  });

  it("campaign_create needs a body, one kind of body, and lists", async () => {
    const base = { name: "n", subject: "s", sender_email: "me@example.com", list_ids: [1] };
    await expect(handleBrevoWrite(client, "campaign_create", base)).rejects.toThrow(/needs a body/);
    await expect(handleBrevoWrite(client, "campaign_create", { ...base, html_content: "<p/>", template_id: 3 })).rejects.toThrow(/not both/);
    request.mockResolvedValue({ id: 9 });
    await handleBrevoWrite(client, "campaign_create", { ...base, html_content: "<p>hi</p>", sender_name: "Me" });
    expect(request).toHaveBeenCalledWith("POST", "/emailCampaigns", {
      body: { name: "n", subject: "s", sender: { email: "me@example.com", name: "Me" }, htmlContent: "<p>hi</p>", recipients: { listIds: [1] } },
    });
  });

  it("list_members_update adds and removes in one call each, capped", async () => {
    request.mockResolvedValue({ contacts: { success: [] } });
    await handleBrevoWrite(client, "list_members_update", { list_id: 3, add: ["a@example.com"], remove: ["b@example.com"] });
    expect(request.mock.calls.map((c) => c[1])).toEqual(["/contacts/lists/{listId}/contacts/add", "/contacts/lists/{listId}/contacts/remove"]);
    const many = Array.from({ length: 151 }, (_, i) => `p${i}@example.com`);
    await expect(handleBrevoWrite(client, "list_members_update", { list_id: 3, add: many })).rejects.toThrow(/at most 150/);
  });

  it("email_send takes a template and recipients, at most fifty", async () => {
    request.mockResolvedValue({ messageId: "<m@x>" });
    await handleBrevoWrite(client, "email_send", { template_id: 4, to: [{ email: "a@example.com", name: "A" }], params: { CODE: "1" } });
    expect(request).toHaveBeenCalledWith("POST", "/smtp/email", { body: { templateId: 4, to: [{ email: "a@example.com", name: "A" }], params: { CODE: "1" } } });
    const many = Array.from({ length: 51 }, (_, i) => ({ email: `p${i}@example.com` }));
    await expect(handleBrevoWrite(client, "email_send", { template_id: 4, to: many })).rejects.toThrow(/at most 50/);
  });

  it("campaign_set_status offers only statuses that stop or file a campaign, never one that sends it", async () => {
    await expect(handleBrevoWrite(client, "campaign_set_status", { campaign_id: 7, status: "queued" })).rejects.toThrow(/one of: suspended, draft, archive, darchive/);
  });
});
