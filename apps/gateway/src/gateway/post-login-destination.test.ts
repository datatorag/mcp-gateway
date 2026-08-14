/**
 * The post-login destination table, all four cases, plus the two query-param
 * rules as assertions of their own.
 *
 * The param rules are tested separately from the URL equality checks on
 * purpose: each is a one-character edit that keeps every URL looking plausible
 * while breaking something silently, and in opposite directions - a stray
 * `signup=1` reports logins as signup conversions, a missing `welcome=1` makes
 * the landing unobservable. An equality assertion catches both, but says
 * nothing about which invariant was violated when it fails.
 */

import { describe, expect, it } from "vitest";
import {
  postLoginDestination,
  resolveNextPath,
} from "./post-login-destination";

describe("postLoginDestination", () => {
  describe("AGENT_DEFAULT_VIEW=on", () => {
    it("sends a new user to the agent with both params", () => {
      expect(
        postLoginDestination({ agentDefaultView: true, isNewUser: true })
      ).toBe("/dashboard/agent?signup=1&welcome=1");
    });

    it("sends a returning user to the agent too", () => {
      expect(
        postLoginDestination({ agentDefaultView: true, isNewUser: false })
      ).toBe("/dashboard/agent?welcome=1");
    });
  });

  describe("AGENT_DEFAULT_VIEW=off (unchanged behaviour)", () => {
    it("sends a new user to the dashboard with the signup param", () => {
      expect(
        postLoginDestination({ agentDefaultView: false, isNewUser: true })
      ).toBe("/dashboard?signup=1");
    });

    it("sends a returning user to the bare dashboard", () => {
      expect(
        postLoginDestination({ agentDefaultView: false, isNewUser: false })
      ).toBe("/dashboard");
    });
  });

  describe("a requested path (`next`, SCRUM-71) — the case in FRONT of the table", () => {
    it("lands a returning user exactly where the launch-email link asked", () => {
      // The literal from the observed miss: /auth/login?next=%2Fdashboard%2Fagent.
      // Express decodes the query param once; this is what reaches the code.
      const emailLinkNext = decodeURIComponent("%2Fdashboard%2Fagent");
      expect(
        postLoginDestination({
          agentDefaultView: false, // even with the flag OFF — the user asked
          isNewUser: false,
          requestedPath: emailLinkNext,
        })
      ).toBe("/dashboard/agent?welcome=1");
    });

    it("still gives a new user signup=1 — the sole gate on the Ads conversion", () => {
      expect(
        postLoginDestination({
          agentDefaultView: true,
          isNewUser: true,
          requestedPath: "/dashboard/agent",
        })
      ).toBe("/dashboard/agent?signup=1&welcome=1");
    });

    it("attaches welcome=1 only when the destination IS the agent", () => {
      expect(
        postLoginDestination({
          agentDefaultView: true,
          isNewUser: false,
          requestedPath: "/dashboard/usage",
        })
      ).toBe("/dashboard/usage");
    });

    it("keeps the requested path's own query while adding the login params", () => {
      expect(
        postLoginDestination({
          agentDefaultView: true,
          isNewUser: true,
          requestedPath: "/dashboard/usage?range=30d",
        })
      ).toBe("/dashboard/usage?range=30d&signup=1");
    });

    it("falls back to the UNCHANGED table when the requested path is rejected", () => {
      expect(
        postLoginDestination({
          agentDefaultView: true,
          isNewUser: false,
          requestedPath: "//evil.com",
        })
      ).toBe("/dashboard/agent?welcome=1");
      expect(
        postLoginDestination({
          agentDefaultView: false,
          isNewUser: true,
          requestedPath: "https://evil.com/dashboard",
        })
      ).toBe("/dashboard?signup=1");
    });

    it("falls back — never off-origin — when dot-segments collapse to a protocol-relative path", () => {
      // The escape the raw check cannot see: `/..//evil.com` and its %2e forms
      // pass resolveNextPath, then `new URL(...).pathname` collapses to
      // `//evil.com`. The composed path is what must be validated, so these
      // must land on the table, and the result must never begin with `//`.
      for (const evil of [
        "/..//evil.com",
        "/.//evil.com",
        "/%2e%2e//evil.com",
        "/..//..//evil.com",
      ]) {
        const dest = postLoginDestination({
          agentDefaultView: false,
          isNewUser: false,
          requestedPath: evil,
        });
        expect(dest, evil).toBe("/dashboard");
        expect(dest.startsWith("//"), evil).toBe(false);
      }
    });

    it("strips a caller-supplied signup/welcome from next so it cannot forge a conversion", () => {
      // A returning user is NOT a signup; a next carrying signup=1 would fire
      // the Ads conversion falsely. Our composition owns those params.
      expect(
        postLoginDestination({
          agentDefaultView: false,
          isNewUser: false,
          requestedPath: "/dashboard/usage?signup=1&welcome=1",
        })
      ).toBe("/dashboard/usage");
    });
  });

  describe("query-param rules for a returning user", () => {
    it("never puts signup=1 on a returning user's redirect - it would report every login as a signup conversion", () => {
      for (const agentDefaultView of [true, false]) {
        expect(
          postLoginDestination({ agentDefaultView, isNewUser: false })
        ).not.toContain("signup=1");
      }
    });

    it("always puts welcome=1 on a returning user's agent redirect - without it the landing emits no event", () => {
      expect(
        postLoginDestination({ agentDefaultView: true, isNewUser: false })
      ).toContain("welcome=1");
    });
  });
});

/**
 * The open-redirect boundary, pinned in both directions.
 *
 * An unvalidated post-login redirect is a phishing primitive: the victim
 * authenticates against OUR genuine domain and we hand them to the attacker.
 * Every rejection below is a NAMED case, not a loop — when one fails, the
 * failure says which escape hatch reopened. And the accepts matter as much as
 * the rejects: a validator that rejects everything passes every
 * rejection test while silently killing the feature, and the first person it
 * blocks deletes it.
 */
describe("resolveNextPath", () => {
  it("accepts the real email-link path", () => {
    expect(resolveNextPath("/dashboard/agent")).toBe("/dashboard/agent");
  });

  it("accepts a path with a query, and a hyphenated path", () => {
    expect(resolveNextPath("/dashboard/usage?range=30d")).toBe(
      "/dashboard/usage?range=30d"
    );
    expect(resolveNextPath("/docs/getting-started")).toBe(
      "/docs/getting-started"
    );
  });

  it("rejects an absolute URL", () => {
    expect(resolveNextPath("https://evil.com/dashboard")).toBeNull();
    expect(resolveNextPath("http://evil.com")).toBeNull();
  });

  it("rejects a protocol-relative //evil.com", () => {
    expect(resolveNextPath("//evil.com")).toBeNull();
    expect(resolveNextPath("//evil.com/dashboard")).toBeNull();
  });

  it("rejects the backslash twin /\\evil.com — browsers treat \\ as /", () => {
    expect(resolveNextPath("/\\evil.com")).toBeNull();
    expect(resolveNextPath("\\/evil.com")).toBeNull();
    expect(resolveNextPath("\\\\evil.com")).toBeNull();
  });

  it("rejects a backslash anywhere, not only in front", () => {
    expect(resolveNextPath("/dashboard\\@evil.com")).toBeNull();
  });

  it("rejects an encoded scheme, decoded once or still encoded", () => {
    // What Express hands over after decoding ?next=https%3A%2F%2Fevil.com:
    expect(resolveNextPath("https://evil.com")).toBeNull();
    // A double-encoded value that survived the first decode:
    expect(resolveNextPath("https%3A%2F%2Fevil.com")).toBeNull();
  });

  it("rejects a surviving encoded slash or backslash — a double-encoding trick aimed at the next decoder", () => {
    expect(resolveNextPath("/%2F%2Fevil.com")).toBeNull();
    expect(resolveNextPath("/%2f%2fevil.com")).toBeNull();
    expect(resolveNextPath("/%5Cevil.com")).toBeNull();
  });

  it("passes the raw dot-segment forms through (the OUTPUT guard is what stops them)", () => {
    // resolveNextPath deliberately does NOT reject these — they read as a
    // single-slash path here, and the leading `//` only appears after URL
    // normalisation. This documents that the output guard in
    // postLoginDestination, not this function, is the check that catches the
    // collapse; a test asserting these return null here would be asserting a
    // defence that lives one layer up, and would go stale if it moved.
    expect(resolveNextPath("/..//evil.com")).toBe("/..//evil.com");
    expect(resolveNextPath("/%2e%2e//evil.com")).toBe("/%2e%2e//evil.com");
  });

  it("rejects control characters, non-strings, empty, and the absurdly long", () => {
    expect(resolveNextPath("/dash\nboard")).toBeNull();
    expect(resolveNextPath("/dash\rboard")).toBeNull();
    expect(resolveNextPath(undefined)).toBeNull();
    expect(resolveNextPath(42)).toBeNull();
    expect(resolveNextPath("")).toBeNull();
    expect(resolveNextPath("/" + "a".repeat(600))).toBeNull();
  });
});
