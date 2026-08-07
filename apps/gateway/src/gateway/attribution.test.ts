import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import type { Database } from "@datatorag-mcp/db";
import {
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

function fakeReq(parts: { query?: unknown; cookies?: unknown }) {
  return { query: parts.query ?? {}, cookies: parts.cookies ?? {} } as unknown as Request;
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
