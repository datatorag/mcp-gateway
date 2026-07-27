import { describe, expect, it } from "vitest";
import { utmFromSearchParams } from "./contact-utm";

describe("utmFromSearchParams", () => {
  it("maps internal ?from= links to a synthetic source and medium", () => {
    expect(utmFromSearchParams({ from: "pricing" })).toEqual({
      source: "pricing_page",
      medium: "internal",
      campaign: undefined,
      term: undefined,
      content: undefined,
    });
  });

  it("lets real utm_* params win over ?from=", () => {
    const utm = utmFromSearchParams({
      from: "pricing",
      utm_source: "google",
      utm_medium: "cpc",
      utm_campaign: "spring-launch",
    });
    expect(utm.source).toBe("google");
    expect(utm.medium).toBe("cpc");
    expect(utm.campaign).toBe("spring-launch");
  });

  it("leaves everything undefined for a bare visit", () => {
    expect(utmFromSearchParams({})).toEqual({
      source: undefined,
      medium: undefined,
      campaign: undefined,
      term: undefined,
      content: undefined,
    });
  });
});
