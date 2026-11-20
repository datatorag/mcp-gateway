import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

/* The leads table holds two forms: the contact form (source "demo", the
 * column's default) and the custom integration request (source
 * "custom_integration", with the service it asks for). */

const insertValues = vi.fn();
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: insertValues }) } }));
vi.mock("@/gateway/leads/limiter", () => ({
  leadsMinuteLimiter: { check: () => ({ ok: true, retryAfterMs: 0 }) },
  leadsHourLimiter: { check: () => ({ ok: true, retryAfterMs: 0 }) },
}));
vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ LEADS_IP_SALT: "salt", LEADS_CONFIRMATION_FROM: "sender@example.com" }),
}));
const sendSlack = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/slack", () => ({ sendSlack: (...a: unknown[]) => sendSlack(...a) }));
vi.mock("@/gateway/leads/confirmation", () => ({ sendLeadConfirmation: vi.fn().mockResolvedValue(true) }));

import { POST } from "./route";

const post = (body: object) =>
  POST(
    new NextRequest("http://localhost/api/leads", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );

const person = { name: "Ada Lovelace", email: "ada@example.com", company: "Analytical Engines" };
const stored = () => insertValues.mock.calls[0][0] as Record<string, unknown>;

describe("the source of a lead", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    insertValues.mockResolvedValue(undefined);
  });

  it("the contact form sends none and is stored as demo, with no service", async () => {
    expect((await post(person)).status).toBe(200);
    expect(stored()).toMatchObject({ source: "demo", service: null });
  });

  it("a custom integration request is stored with its source, service and note", async () => {
    const res = await post({ ...person, source: "custom_integration", service: "Linear", useCase: "file issues" });
    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ source: "custom_integration", service: "Linear", useCase: "file issues" });
    expect(sendSlack).toHaveBeenCalledWith(
      "leads",
      expect.objectContaining({ text: expect.stringMatching(/^🟢 Custom integration request: .*\nService: Linear/) })
    );
  });

  it.each([undefined, "", "   "])("a custom integration request with service %j is refused", async (service) => {
    const res = await post({ ...person, source: "custom_integration", ...(service === undefined ? {} : { service }) });
    expect(res.status).toBe(400);
    expect(insertValues).not.toHaveBeenCalled();
  });

  it.each([undefined, "demo"])("a service sent with source %j is not stored on a demo row", async (source) => {
    const res = await post({ ...person, ...(source ? { source } : {}), service: "anything" });
    expect(res.status).toBe(200);
    expect(stored()).toMatchObject({ source: "demo", service: null });
  });

  it("an unknown source is refused", async () => {
    expect((await post({ ...person, source: "newsletter" })).status).toBe(400);
    expect(insertValues).not.toHaveBeenCalled();
  });
});
