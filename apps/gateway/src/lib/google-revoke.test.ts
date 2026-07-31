import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GOOGLE_REVOKE_URL, revokeGoogleToken } from "./google-revoke";

const TOKEN = "1//refresh-token-value-that-must-never-leak";

const fetchMock = vi.fn();
const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("revokeGoogleToken", () => {
  it("POSTs the token in the form body, never the URL", async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });

    await expect(revokeGoogleToken(TOKEN)).resolves.toBe(true);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(GOOGLE_REVOKE_URL);
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe("POST");
    expect(String(init.body)).toContain(`token=${encodeURIComponent(TOKEN)}`);
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns false on a non-ok response and logs only the status", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 400 });

    await expect(revokeGoogleToken(TOKEN)).resolves.toBe(false);

    const logged = warnSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("400");
    expect(logged).not.toContain(TOKEN);
  });

  it("swallows a network failure and logs only the error name", async () => {
    fetchMock.mockRejectedValue(
      Object.assign(new Error(`request to ...token=${TOKEN} failed`), {
        name: "FetchError",
      })
    );

    await expect(revokeGoogleToken(TOKEN)).resolves.toBe(false);

    const logged = warnSpy.mock.calls.flat().join(" ");
    expect(logged).toContain("FetchError");
    // The error MESSAGE may embed request details, so only the name may log.
    expect(logged).not.toContain(TOKEN);
  });
});
