import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BrevoApiError, BrevoClient, BrevoUnreachableError, errorFor, fillPath, NO_TOKEN_MESSAGE } from "./brevo-client.js";
import { retryClock } from "./rate-limit-retry.js";
import { errorMetaFor } from "./error-meta.js";

const fetchMock = vi.fn();

function answer(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  vi.spyOn(retryClock, "sleep").mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const reader = () => new BrevoClient({ accessToken: "tok", readOnlyTool: true });
const writer = () => new BrevoClient({ accessToken: "tok", readOnlyTool: false });

describe("BrevoClient.request", () => {
  it("sends the token as a Bearer to the v3 base, with the path filled and encoded", async () => {
    fetchMock.mockResolvedValue(answer(200, { ok: 1 }));
    await reader().request("GET", "/contacts/{identifier}", { params: { identifier: "a+b@example.com" }, query: { limit: 10, skip: undefined } });
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe("https://api.brevo.com/v3/contacts/a%2Bb%40example.com?limit=10");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
  });

  it("refuses with no token before any request", async () => {
    await expect(new BrevoClient().request("GET", "/account")).rejects.toThrow(NO_TOKEN_MESSAGE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("puts 401 and 402 in words", async () => {
    fetchMock.mockResolvedValueOnce(answer(401, { code: "unauthorized", message: "Key not found" }));
    await expect(reader().request("GET", "/account")).rejects.toThrow(/needs reconnecting/);
    fetchMock.mockResolvedValueOnce(answer(402, { code: "not_enough_credits", message: "No credits" }));
    await expect(writer().request("POST", "/emailCampaigns/{id}/sendNow", { params: { id: 7 } })).rejects.toThrow(
      /lack of credits or because today's send limit is used up/
    );
  });

  it("retries a read's 429 when the reset fits the budget", async () => {
    fetchMock
      .mockResolvedValueOnce(answer(429, { code: "too_many_requests" }, { "x-sib-ratelimit-reset": "2" }))
      .mockResolvedValueOnce(answer(200, { ok: 1 }));
    await expect(reader().request("GET", "/account")).resolves.toEqual({ ok: 1 });
    expect(retryClock.sleep).toHaveBeenCalledWith(2000);
  });

  it("answers a read's 429 at once when the reset is far off, saying when, and never sleeps", async () => {
    fetchMock.mockResolvedValue(answer(429, { code: "too_many_requests" }, { "x-sib-ratelimit-reset": "2700" }));
    const err = (await reader().request("GET", "/emailCampaigns").catch((e: unknown) => e)) as BrevoApiError;
    expect(err).toBeInstanceOf(BrevoApiError);
    expect(err.message).toMatch(/resets in 45 minutes/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(retryClock.sleep).not.toHaveBeenCalled();
    // Never charged to the user: the gateway reads a 429 as not theirs.
    expect(errorMetaFor(err)).toEqual({ kind: "http", status: 429, reason: "too_many_requests" });
  });

  it("never retries a write's 429", async () => {
    fetchMock.mockResolvedValue(answer(429, {}, { "x-sib-ratelimit-reset": "1" }));
    await expect(writer().request("POST", "/contacts", { body: {} })).rejects.toThrow(/not sent again because this tool changes/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never retries a 5xx, and says a write with no answer may have been applied", async () => {
    fetchMock.mockResolvedValueOnce(answer(503, "<html>"));
    await expect(reader().request("GET", "/account")).rejects.toThrow(/Brevo answered 503/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockRejectedValueOnce(new TypeError("fetch failed", { cause: new Error("ECONNRESET") }));
    const err = (await writer().request("POST", "/smtp/email", { body: {} }).catch((e: unknown) => e)) as Error;
    expect(err).toBeInstanceOf(BrevoUnreachableError);
    expect(err.message).toMatch(/may or may not have been applied/);
  });

  it("logs the path template only, never a contact's address", async () => {
    fetchMock
      .mockResolvedValueOnce(answer(429, {}, { "x-sib-ratelimit-reset": "1" }))
      .mockResolvedValueOnce(answer(200, {}));
    await reader().request("GET", "/contacts/{identifier}", { params: { identifier: "person@example.com" } });
    const logged = (console.error as unknown as ReturnType<typeof vi.fn>).mock.calls.flat().join(" ");
    expect(logged).toContain("/contacts/{identifier}");
    expect(logged).not.toContain("person");
  });
});

describe("fillPath and errorFor", () => {
  it("refuses a template value the call did not give", () => {
    expect(() => fillPath("/contacts/{identifier}")).toThrow(/no value/);
  });

  it("says Brevo's own message for any other refusal", () => {
    expect(errorFor(400, JSON.stringify({ code: "invalid_parameter", message: "email is not valid" }), null).message).toBe(
      "Brevo answered 400 invalid_parameter: email is not valid"
    );
  });
});
