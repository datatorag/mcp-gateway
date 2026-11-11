import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import { NextRequest } from "next/server";

/* SCRUM-76: a lead's IP is stored only as a salted hash. Without a salt the
 * hash of an IPv4 address is the address in disguise (it reverses by brute
 * force), so the route stores no hash at all, the rule `peerHash` follows.
 * The lead itself is still saved. */

const insertValues = vi.fn();
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: insertValues }) } }));
const limiterKeys: string[] = [];
vi.mock("@/gateway/leads/limiter", () => ({
  leadsMinuteLimiter: { check: (k: string) => (limiterKeys.push(k), { ok: true, retryAfterMs: 0 }) },
  leadsHourLimiter: { check: () => ({ ok: true, retryAfterMs: 0 }) },
}));
const env = vi.hoisted(() => ({ LEADS_IP_SALT: "", LEADS_CONFIRMATION_FROM: "sender@example.com" }));
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => env }));
vi.mock("@/lib/slack", () => ({ sendSlack: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/gateway/leads/confirmation", () => ({ sendLeadConfirmation: vi.fn().mockResolvedValue(true) }));

import { POST } from "./route";

const IP = "203.0.113.7";

function leadRequest(): NextRequest {
  return new NextRequest("http://localhost/api/leads", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": IP },
    body: JSON.stringify({ name: "Ada Lovelace", email: "ada@example.com", company: "Analytical Engines" }),
  });
}

const stored = () => insertValues.mock.calls[0][0] as { ipHash: string | null; email: string };

describe("the lead's IP hash", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    limiterKeys.length = 0;
    insertValues.mockResolvedValue(undefined);
  });

  it("with a salt: stores the salted hash", async () => {
    env.LEADS_IP_SALT = "a-salt";
    expect((await POST(leadRequest())).status).toBe(200);
    expect(stored().ipHash).toBe(createHash("sha256").update(`a-salt:${IP}`).digest("hex"));
  });

  it.each(["", "   "])("with no salt (%j): saves the lead with no hash, never an unsalted one", async (salt) => {
    env.LEADS_IP_SALT = salt;
    expect((await POST(leadRequest())).status).toBe(200);
    expect(stored().email).toBe("ada@example.com");
    expect(stored().ipHash).toBeNull();
    // The unsalted form the route stored before, by name, so it cannot return.
    expect(JSON.stringify(insertValues.mock.calls)).not.toContain(createHash("sha256").update(`:${IP}`).digest("hex"));
  });

  it("with no salt: the rate limit still holds per caller", async () => {
    env.LEADS_IP_SALT = "";
    await POST(leadRequest());
    expect(limiterKeys).toEqual([IP]);
  });
});
