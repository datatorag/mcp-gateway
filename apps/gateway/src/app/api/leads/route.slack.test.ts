import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const insertValues = vi.fn();
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: insertValues }) } }));
vi.mock("@/gateway/leads/limiter", () => ({
  leadsMinuteLimiter: { check: () => ({ ok: true, retryAfterMs: 0 }) },
  leadsHourLimiter: { check: () => ({ ok: true, retryAfterMs: 0 }) },
}));
vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({
    LEADS_IP_SALT: "salt",
    LEADS_CONFIRMATION_FROM: "sender@example.com",
  }),
}));
vi.mock("@/lib/slack", () => ({ sendSlack: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/gateway/leads/confirmation", () => ({
  sendLeadConfirmation: vi.fn().mockResolvedValue(true),
}));

import { POST } from "./route";
import { sendSlack } from "@/lib/slack";
import { sendLeadConfirmation } from "@/gateway/leads/confirmation";

function leadRequest(body: object): NextRequest {
  return new NextRequest("http://localhost/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validLead = { name: "Ada Lovelace", email: "ada@example.com", company: "Analytical Engines" };

describe("leads route slack hooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValues.mockResolvedValue(undefined);
  });

  it("notifies #leads after a successful insert", async () => {
    const res = await POST(leadRequest(validLead));
    expect(res.status).toBe(200);
    expect(sendSlack).toHaveBeenCalledWith(
      "leads",
      expect.objectContaining({ text: expect.stringContaining("ada@example.com") })
    );
  });

  it("notifies #ops-alerts with the contact when the insert fails", async () => {
    insertValues.mockRejectedValue(new Error("connection refused"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await POST(leadRequest(validLead));
    expect(res.status).toBe(500);
    expect(sendSlack).toHaveBeenCalledWith(
      "alerts",
      expect.objectContaining({
        text: expect.stringMatching(/ada@example\.com[\s\S]*connection refused/),
      })
    );
    errSpy.mockRestore();
  });

  it("does NOT notify on honeypot submissions", async () => {
    const res = await POST(leadRequest({ ...validLead, website: "http://spam.example" }));
    expect(res.status).toBe(200);
    expect(sendSlack).not.toHaveBeenCalled();
  });

  it("confirms to the submitter after a successful insert", async () => {
    await POST(leadRequest(validLead));
    expect(sendLeadConfirmation).toHaveBeenCalledWith({
      name: "Ada Lovelace",
      email: "ada@example.com",
      senderEmail: "sender@example.com",
    });
  });

  // A honeypot hit is a bot supplying an arbitrary address. Mailing it would
  // turn our own form into a way to send DataToRAG-branded mail to a stranger.
  it("does NOT confirm on honeypot submissions", async () => {
    await POST(leadRequest({ ...validLead, website: "http://spam.example" }));
    expect(sendLeadConfirmation).not.toHaveBeenCalled();
  });

  it("does NOT confirm when the lead row failed to save", async () => {
    insertValues.mockRejectedValue(new Error("connection refused"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await POST(leadRequest(validLead));
    expect(sendLeadConfirmation).not.toHaveBeenCalled();
    errSpy.mockRestore();
  });

  // The send is fire-and-forget: a Brevo outage must not turn a saved lead
  // into a 500 for someone who filled the form in correctly. sendLeadConfirmation
  // reports failure by resolving false (see its own test for that contract).
  it("still returns 200 when the confirmation does not send", async () => {
    vi.mocked(sendLeadConfirmation).mockResolvedValueOnce(false);
    const res = await POST(leadRequest(validLead));
    expect(res.status).toBe(200);
  });
});
