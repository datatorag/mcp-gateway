import { describe, it, expect, vi, beforeEach } from "vitest";

const env = { BREVO_API_KEY: "" };
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => env }));

import {
  isInternalEmail,
  hasBrevoKey,
  upsertBrevoContact,
  sendBrevoTemplate,
  BREVO_LIST_PRODUCT_USERS,
} from "./brevo";

const fetchMock = vi.fn();
vi.stubGlobal("fetch", fetchMock);

describe("isInternalEmail", () => {
  it("matches the datatorag domain and known founder emails", () => {
    expect(isInternalEmail("manuel@datatorag.com")).toBe(true);
    expect(isInternalEmail("anyone@datatorag.com")).toBe(true);
    expect(isInternalEmail("HeyItsManuel@gmail.com")).toBe(true);
    expect(isInternalEmail("myang@life360.com")).toBe(true);
    expect(isInternalEmail("realuser@gmail.com")).toBe(false);
  });
});

describe("brevo client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    env.BREVO_API_KEY = "test-key";
    fetchMock.mockResolvedValue(new Response(null, { status: 201 }));
  });

  it("is a warned no-op without an API key", async () => {
    env.BREVO_API_KEY = "";
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(hasBrevoKey()).toBe(false);
    const ok = await sendBrevoTemplate(2, "a@b.com", { FIRSTNAME: "A" });
    expect(ok).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("upserts a contact into the Product Users list", async () => {
    const ok = await upsertBrevoContact({
      email: "a@b.com",
      firstName: "Ada",
      signupDate: new Date("2026-07-18T05:00:00Z"),
      plan: "pro_trial",
    });
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/contacts");
    expect(init.headers["api-key"]).toBe("test-key");
    expect(JSON.parse(init.body)).toEqual({
      email: "a@b.com",
      updateEnabled: true,
      listIds: [BREVO_LIST_PRODUCT_USERS],
      attributes: { FIRSTNAME: "Ada", SIGNUP_DATE: "2026-07-18", PLAN: "pro_trial" },
    });
  });

  it("sends a transactional template with params", async () => {
    const ok = await sendBrevoTemplate(3, "a@b.com", { FIRSTNAME: "Ada" });
    expect(ok).toBe(true);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.brevo.com/v3/smtp/email");
    expect(JSON.parse(init.body)).toEqual({
      to: [{ email: "a@b.com" }],
      templateId: 3,
      params: { FIRSTNAME: "Ada" },
    });
  });

  it("returns false on non-2xx and never throws", async () => {
    fetchMock.mockResolvedValue(new Response("bad key", { status: 401 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendBrevoTemplate(2, "a@b.com", {})).resolves.toBe(false);
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(sendBrevoTemplate(2, "a@b.com", {})).resolves.toBe(false);
    warnSpy.mockRestore();
  });
});
