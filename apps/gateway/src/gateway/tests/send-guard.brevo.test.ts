/**
 * SCRUM-468: what a test run may do to the Brevo account. A Brevo write can
 * reach every contact on a list, and a sent email cannot be recalled, so the
 * guard refuses every real send and allows writes only on the fixtures.
 */
import { describe, expect, it } from "vitest";
import { checkSend, type BrevoScope } from "./send-guard";

const scope: BrevoScope = { contact: "fixture@example.com", secondList: "12", draftCampaign: "34" };
const READER = "reader@example.com";
const lookups = {} as Parameters<typeof checkSend>[2]["lookups"];

/** `null` is a run with no Brevo scope. */
const check = (tool: string, args: Record<string, unknown>, s: BrevoScope | null = scope) =>
  checkSend(`brevo-mcp__${tool}`, args, { readerEmail: READER, lookups, brevo: s ?? undefined });

describe("the Brevo send guard", () => {
  it("lets every read through, with or without a scope", async () => {
    for (const tool of ["account_get", "contacts_search", "campaign_get", "email_log", "campaign_export_recipients"]) {
      expect(await check(tool, {}, null)).toEqual({ ok: true });
    }
  });

  it("refuses every real send, whatever it names", async () => {
    expect((await check("campaign_send", { campaign_id: 34 })).ok).toBe(false);
    expect((await check("email_send", { template_id: 1, to: [{ email: READER }] })).ok).toBe(false);
  });

  it("allows a campaign test only of the fixture draft, and only to the reader", async () => {
    expect(await check("campaign_send_test", { campaign_id: 34, emails: [READER] })).toEqual({ ok: true });
    expect((await check("campaign_send_test", { campaign_id: 35, emails: [READER] })).ok).toBe(false);
    expect((await check("campaign_send_test", { campaign_id: 34, emails: [READER, "someone@example.com"] })).ok).toBe(false);
    expect((await check("campaign_send_test", { campaign_id: 34, emails: [] })).ok).toBe(false);
  });

  it("allows contact and list writes only on the fixture contact and second list", async () => {
    expect(await check("contact_update", { identifier: "Fixture@Example.com", attributes: {} })).toEqual({ ok: true });
    expect((await check("contact_update", { identifier: "other@example.com" })).ok).toBe(false);
    expect(await check("list_members_update", { list_id: 12, add: ["fixture@example.com"] })).toEqual({ ok: true });
    expect((await check("list_members_update", { list_id: 13, add: ["fixture@example.com"] })).ok).toBe(false);
    expect((await check("list_members_update", { list_id: 12, add: ["fixture@example.com", "other@example.com"] })).ok).toBe(false);
  });

  it("allows campaign changes only on the fixture draft, and a status only if it sends nothing", async () => {
    expect(await check("campaign_update", { campaign_id: 34, name: "x" })).toEqual({ ok: true });
    expect((await check("campaign_update", { campaign_id: 99, name: "x" })).ok).toBe(false);
    expect(await check("campaign_set_status", { campaign_id: 34, status: "draft" })).toEqual({ ok: true });
    expect((await check("campaign_set_status", { campaign_id: 34, status: "queued" })).ok).toBe(false);
  });

  it("refuses a write with no rule, and every write when the run has no Brevo scope", async () => {
    expect((await check("contact_create", { email: "fixture@example.com" })).ok).toBe(false);
    expect((await check("campaign_create", { name: "x" })).ok).toBe(false);
    expect((await check("contact_update", { identifier: "fixture@example.com" }, null)).ok).toBe(false);
  });

  it("never lets a Brevo send fall through to the mail rule, where its bare name would be unknown", async () => {
    // campaign_send has no gws counterpart; without the namespace check it
    // would reach the mail rule and pass as a tool that needs no guard.
    const verdict = await checkSend("brevo-mcp__campaign_send", { campaign_id: 34 }, { readerEmail: READER, lookups });
    expect(verdict.ok).toBe(false);
  });
});
