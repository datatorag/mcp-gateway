import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const insertValues = vi.fn();
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: insertValues }) } }));
vi.mock("@/gateway/leads/limiter", () => ({
  leadsMinuteLimiter: { check: () => ({ ok: true, retryAfterMs: 0 }) },
  leadsHourLimiter: { check: () => ({ ok: true, retryAfterMs: 0 }) },
}));
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => ({ LEADS_IP_SALT: "salt" }) }));
vi.mock("@/lib/slack", () => ({ sendSlack: vi.fn().mockResolvedValue(undefined) }));

import { POST } from "./route";
import { sendSlack } from "@/lib/slack";

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
});
