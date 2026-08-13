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
import { postLoginDestination } from "./post-login-destination";

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
