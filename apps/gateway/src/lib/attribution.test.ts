import { describe, expect, it } from "vitest";
import {
  acquisitionProps,
  acquisitionSetOnce,
  deriveChannel,
  isEmptyAttribution,
  parseAttribution,
  sessionProps,
  toWireParams,
} from "./attribution";

function attribution(overrides: Record<string, string> = {}) {
  return parseAttribution(overrides);
}

describe("parseAttribution", () => {
  it("reads every field off a query bag", () => {
    const a = parseAttribution({
      a_sid: "0198-session",
      a_did: "0198-person",
      a_utm_source: "google",
      a_utm_medium: "cpc",
      a_utm_campaign: "9876543210",
      a_gclid: "Cj0KCQ",
      a_gad_source: "1",
      a_ref_domain: "www.google.com",
      a_entry_url: "https://datatorag.com/?gclid=Cj0KCQ",
    });
    expect(a).toEqual({
      sessionId: "0198-session",
      distinctId: "0198-person",
      utmSource: "google",
      utmMedium: "cpc",
      utmCampaign: "9876543210",
      gclid: "Cj0KCQ",
      gadSource: "1",
      referringDomain: "www.google.com",
      entryUrl: "https://datatorag.com/?gclid=Cj0KCQ",
    });
  });

  it("treats the no-referrer sentinel as absent, not as a referring domain", () => {
    const a = parseAttribution({ a_ref_domain: "$direct" });
    expect(a.referringDomain).toBeNull();
    expect(deriveChannel(a)).toBe("Direct");
  });

  it("treats a same-origin referring domain like the no-referrer sentinel", () => {
    const a = parseAttribution(
      { a_ref_domain: "datatorag.com", a_sid: "s1" },
      { ownHost: "datatorag.com" }
    );
    expect(a.referringDomain).toBeNull();
    // An internal navigation must establish no channel — without the filter
    // this reads "Referral", a confident lie about our own domain.
    expect(deriveChannel(a)).toBe("Direct");
  });

  it("matches subdomain variants of our own host in both directions", () => {
    expect(
      parseAttribution(
        { a_ref_domain: "www.datatorag.com" },
        { ownHost: "datatorag.com" }
      ).referringDomain
    ).toBeNull();
    expect(
      parseAttribution(
        { a_ref_domain: "datatorag.com" },
        { ownHost: "www.datatorag.com" }
      ).referringDomain
    ).toBeNull();
  });

  it("keeps a cross-origin referrer intact when our own host is known", () => {
    const a = parseAttribution(
      { a_ref_domain: "someblog.dev" },
      { ownHost: "datatorag.com" }
    );
    expect(a.referringDomain).toBe("someblog.dev");
    expect(deriveChannel(a)).toBe("Referral");
    // A lookalike suffix is not our domain.
    expect(
      parseAttribution(
        { a_ref_domain: "evil-datatorag.com" },
        { ownHost: "datatorag.com" }
      ).referringDomain
    ).toBe("evil-datatorag.com");
  });

  it("leaves the referrer alone when the caller cannot name its own host", () => {
    expect(
      parseAttribution({ a_ref_domain: "datatorag.com" }).referringDomain
    ).toBe("datatorag.com");
    expect(
      parseAttribution({ a_ref_domain: "datatorag.com" }, { ownHost: null })
        .referringDomain
    ).toBe("datatorag.com");
  });

  it("normalises blanks, whitespace and non-strings to null", () => {
    const a = parseAttribution({
      a_sid: "   ",
      a_utm_source: "  google  ",
      a_gclid: 42 as unknown as string,
    });
    expect(a.sessionId).toBeNull();
    expect(a.utmSource).toBe("google");
    expect(a.gclid).toBeNull();
  });

  it("takes the first value when a param is repeated", () => {
    expect(parseAttribution({ a_sid: ["first", "second"] }).sessionId).toBe(
      "first"
    );
  });

  it("caps a value so a long entry url cannot blow the cookie budget", () => {
    const long = `https://datatorag.com/?q=${"x".repeat(2000)}`;
    expect(parseAttribution({ a_entry_url: long }).entryUrl).toHaveLength(500);
  });

  it("returns an all-null snapshot for missing input", () => {
    expect(isEmptyAttribution(parseAttribution(undefined))).toBe(true);
    expect(isEmptyAttribution(parseAttribution({ unrelated: "x" }))).toBe(true);
  });

  it("round-trips through the wire names", () => {
    const original = attribution({
      a_sid: "s1",
      a_utm_campaign: "brand",
      a_ref_domain: "news.ycombinator.com",
    });
    expect(parseAttribution(toWireParams(original))).toEqual(original);
  });

  it("accepts URLSearchParams as the source", () => {
    const params = new URLSearchParams({ a_sid: "s1", a_gclid: "g1" });
    expect(parseAttribution(params).sessionId).toBe("s1");
    expect(parseAttribution(params).gclid).toBe("g1");
  });
});

describe("deriveChannel", () => {
  it("reads a click id as paid search even with no utm tags", () => {
    expect(deriveChannel(attribution({ a_gclid: "Cj0KCQ" }))).toBe("Paid Search");
    expect(deriveChannel(attribution({ a_gad_source: "1" }))).toBe("Paid Search");
  });

  it("splits paid traffic by source", () => {
    expect(
      deriveChannel(attribution({ a_utm_medium: "cpc", a_utm_source: "bing" }))
    ).toBe("Paid Search");
    expect(
      deriveChannel(attribution({ a_utm_medium: "cpc", a_utm_source: "linkedin" }))
    ).toBe("Paid Social");
    expect(
      deriveChannel(attribution({ a_utm_medium: "cpc", a_utm_source: "someexchange" }))
    ).toBe("Paid Other");
  });

  it("classifies organic referrers by domain", () => {
    expect(deriveChannel(attribution({ a_ref_domain: "www.google.co.uk" }))).toBe(
      "Organic Search"
    );
    expect(deriveChannel(attribution({ a_ref_domain: "t.co" }))).toBe(
      "Organic Social"
    );
    expect(
      deriveChannel(attribution({ a_ref_domain: "news.ycombinator.com" }))
    ).toBe("Organic Social");
    expect(deriveChannel(attribution({ a_ref_domain: "someblog.dev" }))).toBe(
      "Referral"
    );
  });

  it("reads a social medium as Organic Social even when the referrer is stripped", () => {
    // Our own /r/<slug> share links tag utm_medium=social. Reddit does not
    // reliably send a referrer, and without this branch the link we minted
    // to make Reddit measurable would attribute as "Other".
    expect(
      deriveChannel(attribution({ a_utm_medium: "social", a_utm_source: "reddit" }))
    ).toBe("Organic Social");
    expect(
      deriveChannel(attribution({ a_utm_medium: "social-media", a_utm_source: "x" }))
    ).toBe("Organic Social");
    // Paid still wins: a paid medium is a paid medium.
    expect(
      deriveChannel(attribution({ a_utm_medium: "cpc", a_utm_source: "reddit" }))
    ).toBe("Paid Social");
  });

  it("recognises email campaigns", () => {
    expect(
      deriveChannel(attribution({ a_utm_medium: "email", a_utm_source: "brevo" }))
    ).toBe("Email");
  });

  it("falls back to Direct only when there is genuinely no signal", () => {
    expect(deriveChannel(attribution())).toBe("Direct");
    expect(deriveChannel(attribution({ a_sid: "s1" }))).toBe("Direct");
    expect(deriveChannel(attribution({ a_utm_source: "changelog" }))).toBe("Other");
  });

  it("lets a click id win over a referrer, since autotagging is the stronger signal", () => {
    expect(
      deriveChannel(
        attribution({ a_gclid: "Cj0KCQ", a_ref_domain: "someblog.dev" })
      )
    ).toBe("Paid Search");
  });
});

describe("analytics property helpers", () => {
  it("stamps $session_id so a server-side event can be joined to its session", () => {
    expect(sessionProps(attribution({ a_sid: "s1" }))).toEqual({
      $session_id: "s1",
    });
  });

  it("omits $session_id rather than sending an empty one", () => {
    expect(sessionProps(attribution())).toEqual({});
    expect(sessionProps(null)).toEqual({});
    expect(sessionProps(undefined)).toEqual({});
  });

  it("flattens the snapshot onto the event, derived channel included", () => {
    expect(
      acquisitionProps(
        attribution({
          a_gclid: "Cj0KCQ",
          a_utm_campaign: "brand",
          a_ref_domain: "www.google.com",
        })
      )
    ).toEqual({
      acquisition_channel: "Paid Search",
      acquisition_utm_source: null,
      acquisition_utm_medium: null,
      acquisition_utm_campaign: "brand",
      acquisition_gclid: "Cj0KCQ",
      acquisition_referring_domain: "www.google.com",
      acquisition_entry_url: null,
    });
  });

  it("sets person properties once, so a later session cannot overwrite first touch", () => {
    const props = acquisitionSetOnce(attribution({ a_utm_source: "google" }));
    expect(props).toHaveProperty("$set_once");
    expect(props).not.toHaveProperty("$set");
  });

  it("adds nothing when there is no snapshot", () => {
    expect(acquisitionProps(null)).toEqual({});
    expect(acquisitionSetOnce(attribution())).toEqual({});
  });
});
