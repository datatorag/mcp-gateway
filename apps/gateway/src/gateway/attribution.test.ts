import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { Database } from "@datatorag-mcp/db";
import {
  analyticsCookieSignals,
  captureEntry,
  persistAcquisition,
  stashAttribution,
  takeAttribution,
} from "./attribution";
import { parseAttribution } from "../lib/attribution";

function fakeRes() {
  return {
    cookie: vi.fn(),
    clearCookie: vi.fn(),
  } as unknown as Response & { cookie: ReturnType<typeof vi.fn>; clearCookie: ReturnType<typeof vi.fn> };
}

function fakeReq(parts: {
  query?: unknown;
  cookies?: unknown;
  hostname?: string;
  headers?: Record<string, string>;
  url?: string;
  method?: string;
}) {
  const headers = Object.fromEntries(Object.entries(parts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const url = parts.url ?? "/auth/google";
  return {
    query: parts.query ?? {},
    cookies: parts.cookies ?? {},
    hostname: parts.hostname ?? "datatorag.com",
    method: parts.method ?? "GET",
    originalUrl: url,
    path: url.split("?")[0],
    get: (name: string) => headers[name.toLowerCase()],
  } as unknown as Request;
}

const SIGNUP_QUERY = {
  a_sid: "0198abc-session",
  a_did: "0198abc-person",
  a_utm_source: "google",
  a_utm_medium: "cpc",
  a_utm_campaign: "brand-us",
  a_gclid: "Cj0KCQ",
  a_ref_domain: "www.google.com",
  a_entry_url: "https://datatorag.com/?gclid=Cj0KCQ",
};

describe("stashAttribution", () => {
  it("parks the snapshot in a lax first-party cookie so it survives the consent-screen round trip", () => {
    const res = fakeRes();
    stashAttribution(fakeReq({ query: SIGNUP_QUERY }), res, true);

    expect(res.cookie).toHaveBeenCalledWith(
      "dtr_attr",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, secure: true, sameSite: "lax" })
    );
  });

  it("honours the insecure-origin flag for local development", () => {
    const res = fakeRes();
    stashAttribution(fakeReq({ query: SIGNUP_QUERY }), res, false);
    expect(res.cookie).toHaveBeenCalledWith(
      "dtr_attr",
      expect.any(String),
      expect.objectContaining({ secure: false })
    );
  });

  it("writes nothing when the browser sent no usable signals", () => {
    const res = fakeRes();
    stashAttribution(fakeReq({ query: { code: "abc" } }), res, true);
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("does not let a self-referral count as a usable signal", () => {
    const res = fakeRes();
    stashAttribution(
      fakeReq({
        query: { a_ref_domain: "datatorag.com" },
        hostname: "datatorag.com",
      }),
      res,
      true
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });
});

describe("takeAttribution", () => {
  it("returns the snapshot the stash wrote", () => {
    const stashRes = fakeRes();
    stashAttribution(fakeReq({ query: SIGNUP_QUERY }), stashRes, true);
    const cookieValue = stashRes.cookie.mock.calls[0][1] as string;

    const res = fakeRes();
    const taken = takeAttribution(
      fakeReq({ cookies: { dtr_attr: cookieValue } }),
      res
    );

    expect(taken).toEqual(parseAttribution(SIGNUP_QUERY));
  });

  it("clears the cookie even on a malformed payload, so it cannot attach to a later flow", () => {
    const res = fakeRes();
    takeAttribution(fakeReq({ cookies: { dtr_attr: "not json" } }), res);
    expect(res.clearCookie).toHaveBeenCalledWith("dtr_attr", { path: "/" });
  });

  it("does not emit a pointless clear when there was no cookie", () => {
    const res = fakeRes();
    takeAttribution(fakeReq({}), res);
    expect(res.clearCookie).not.toHaveBeenCalled();
  });

  it("returns null for a missing, malformed or empty payload", () => {
    expect(takeAttribution(fakeReq({}), fakeRes())).toBeNull();
    expect(
      takeAttribution(fakeReq({ cookies: { dtr_attr: "{oops" } }), fakeRes())
    ).toBeNull();
    expect(
      takeAttribution(fakeReq({ cookies: { dtr_attr: "{}" } }), fakeRes())
    ).toBeNull();
  });

  it("drops a same-origin referrer on the way out, even from an old cookie", () => {
    const payload = JSON.stringify({
      a_sid: "s1",
      a_ref_domain: "datatorag.com",
      a_entry_url: "https://datatorag.com/auth/login",
    });
    const taken = takeAttribution(
      fakeReq({
        cookies: { dtr_attr: payload },
        hostname: "datatorag.com",
      }),
      fakeRes()
    );
    expect(taken?.sessionId).toBe("s1");
    expect(taken?.referringDomain).toBeNull();
  });

  it("re-normalises the cookie instead of trusting what came back", () => {
    const payload = JSON.stringify({
      a_sid: "  s1  ",
      a_ref_domain: "$direct",
      a_entry_url: `https://datatorag.com/?q=${"x".repeat(2000)}`,
    });
    const taken = takeAttribution(
      fakeReq({ cookies: { dtr_attr: payload } }),
      fakeRes()
    );
    expect(taken?.sessionId).toBe("s1");
    expect(taken?.referringDomain).toBeNull();
    expect(taken?.entryUrl).toHaveLength(500);
  });
});

describe("persistAcquisition", () => {
  const where = vi.fn().mockResolvedValue(undefined);
  const set = vi.fn(() => ({ where }));
  const update = vi.fn(() => ({ set }));
  const db = { update } as unknown as Database;

  beforeEach(() => {
    vi.clearAllMocks();
    where.mockResolvedValue(undefined);
    set.mockImplementation(() => ({ where }));
    update.mockImplementation(() => ({ set }));
  });

  it("writes the snapshot and the derived channel onto the user row", async () => {
    await persistAcquisition(db, "user-1", parseAttribution(SIGNUP_QUERY));

    expect(set).toHaveBeenCalledWith(
      expect.objectContaining({
        acquisitionSessionId: "0198abc-session",
        acquisitionDistinctId: "0198abc-person",
        acquisitionChannel: "Paid Search",
        acquisitionUtmSource: "google",
        acquisitionUtmMedium: "cpc",
        acquisitionUtmCampaign: "brand-us",
        acquisitionGclid: "Cj0KCQ",
        acquisitionReferringDomain: "www.google.com",
      })
    );
  });

  it("skips the write entirely when there is nothing to record", async () => {
    await persistAcquisition(db, "user-1", null);
    await persistAcquisition(db, "user-1", parseAttribution({}));
    expect(update).not.toHaveBeenCalled();
  });

  it("never throws — a failed attribution write must not break the login", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    where.mockRejectedValueOnce(new Error("connection reset"));

    await expect(
      persistAcquisition(db, "user-1", parseAttribution(SIGNUP_QUERY))
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("[attribution]"),
      expect.any(Error)
    );
    warn.mockRestore();
  });
});

/* SCRUM-88: the click decorator stays the precise path, and stops being the
 * only one. A navigation that skipped it (a middle click, a new tab, a link
 * copied into the same browser, the SDK blocked) still reaches the callback
 * with where the visitor came from. */

const NOW = Date.UTC(2026, 10, 8, 18, 0, 0);
const PAID_ENTRY = "https://datatorag.com/docs?gclid=Cj0KPAID&utm_source=google&utm_medium=cpc&utm_campaign=brand";

/** The SDK's cookie as `localStorage+cookie` persistence writes it. */
function analyticsCookie(over: Record<string, unknown> = {}) {
  return JSON.stringify({
    distinct_id: "0198-person",
    $sesid: [NOW - 60_000, "0198-session", NOW - 600_000],
    $initial_person_info: { r: "https://www.google.com/", u: PAID_ENTRY },
    ...over,
  });
}

function stashed(req: Request) {
  const res = fakeRes();
  stashAttribution(req, res, true);
  const value = res.cookie.mock.calls[0]?.[1] as string | undefined;
  return value ? takeAttribution(fakeReq({ cookies: { dtr_attr: value } }), fakeRes()) : null;
}

describe("the server-side fallback (SCRUM-88)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("an undecorated navigation into the flow takes the SDK's cookie: entry, campaign, click id, session and person", () => {
    const taken = stashed(
      fakeReq({
        cookies: { ph_phc_example_posthog: analyticsCookie() },
        headers: { referer: "https://datatorag.com/auth/login" },
      })
    );
    expect(taken).toEqual({
      sessionId: "0198-session",
      distinctId: "0198-person",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "brand",
      gclid: "Cj0KPAID",
      gadSource: null,
      referringDomain: "www.google.com",
      entryUrl: PAID_ENTRY,
    });
  });

  it("the decorator still wins: its snapshot is kept whole over the cookie's", () => {
    const taken = stashed(
      fakeReq({
        query: SIGNUP_QUERY,
        cookies: { ph_phc_example_posthog: analyticsCookie() },
      })
    );
    expect(taken).toEqual(parseAttribution(SIGNUP_QUERY));
  });

  it("a session past its idle timeout or begun on another UTC day is left out", () => {
    const idle = analyticsCookieSignals(
      { ph_k_posthog: analyticsCookie({ $sesid: [NOW - 31 * 60_000, "old", NOW - 40 * 60_000] }) },
      NOW
    );
    expect(idle.a_sid).toBeUndefined();
    const yesterday = analyticsCookieSignals(
      { ph_k_posthog: analyticsCookie({ $sesid: [NOW - 60_000, "old", NOW - 19 * 3_600_000] }) },
      NOW
    );
    expect(yesterday.a_sid).toBeUndefined();
    expect(yesterday.a_did).toBe("0198-person");
  });

  it("with the SDK blocked, the entry this server recorded at the first landing is used", () => {
    const res = fakeRes();
    captureEntry(true)(
      fakeReq({
        url: "/pricing?utm_source=newsletter&utm_medium=email",
        headers: { accept: "text/html", referer: "https://news.example.com/issue/12" },
      }),
      res,
      () => {}
    );
    expect(res.cookie).toHaveBeenCalledWith("dtr_entry", expect.any(String), expect.objectContaining({ httpOnly: true, sameSite: "lax" }));
    const entry = res.cookie.mock.calls[0][1] as string;

    const taken = stashed(fakeReq({ cookies: { dtr_entry: entry }, headers: { referer: "https://datatorag.com/auth/login" } }));
    expect(taken).toMatchObject({
      utmSource: "newsletter",
      utmMedium: "email",
      referringDomain: "news.example.com",
      entryUrl: "https://datatorag.com/pricing?utm_source=newsletter&utm_medium=email",
      sessionId: null,
    });
  });

  it("the first landing is kept: a later page load does not overwrite it", () => {
    const res = fakeRes();
    captureEntry(true)(
      fakeReq({ url: "/?gclid=later", cookies: { dtr_entry: "{}" }, headers: { accept: "text/html" } }),
      res,
      () => {}
    );
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it("records nothing for an internal navigation, a direct visit, a provider's redirect back, an asset or a link that carries a credential", () => {
    const cases: Array<{ url: string; headers: Record<string, string> }> = [
      { url: "/docs", headers: { accept: "text/html", referer: "https://datatorag.com/" } },
      { url: "/docs", headers: { accept: "text/html" } },
      { url: "/auth/google/callback?code=x", headers: { accept: "text/html", referer: "https://accounts.google.com/" } },
      { url: "/_next/static/chunk.js?utm_source=x", headers: { accept: "*/*", referer: "https://www.google.com/" } },
      { url: "/logo.png", headers: { accept: "image/png", referer: "https://www.google.com/" } },
      // A credential in the path never becomes an entry URL.
      { url: "/connect/tok_secret", headers: { accept: "text/html", referer: "https://claude.ai/" } },
      { url: "/files/d/nonce.tag", headers: { accept: "text/html", referer: "https://claude.ai/" } },
      { url: "/Connect/tok_secret", headers: { accept: "text/html", referer: "https://claude.ai/" } },
      // The landing after sign-in keeps Google's referrer; it is not an acquisition.
      { url: "/dashboard/agent?signup=1&welcome=1", headers: { accept: "text/html", referer: "https://accounts.google.com/" } },
    ];
    for (const c of cases) {
      const res = fakeRes();
      captureEntry(true)(fakeReq(c), res, () => {});
      expect(res.cookie, c.url).not.toHaveBeenCalled();
    }
  });

  it("a navigation with no decoration, no SDK cookie, no recorded entry and only a same-site referrer stashes nothing", () => {
    const res = fakeRes();
    stashAttribution(fakeReq({ headers: { referer: "https://datatorag.com/auth/login" } }), res, true);
    expect(res.cookie).not.toHaveBeenCalled();
  });
});
