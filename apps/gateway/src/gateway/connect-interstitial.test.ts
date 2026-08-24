/**
 * SCRUM-150: the instruction page's copy and structure. The router-level
 * behaviour (when it renders, what the proceed leg does) lives in
 * auth-connect-csrf.test.ts; this file pins the words and the link contract.
 */

import { describe, expect, it } from "vitest";
import {
  ALL_INTERSTITIAL_COPY,
  INTERSTITIAL_EXPLANATION,
  INTERSTITIAL_INSTRUCTION,
  INTERSTITIAL_SELECT_ALL,
  googleConnectProceedUrl,
  renderConnectInterstitial,
} from "./connect-interstitial";

describe("interstitial copy rules", () => {
  it("contains no em-dashes and no scope URLs", () => {
    for (const line of ALL_INTERSTITIAL_COPY) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("&mdash;");
      expect(line).not.toContain("googleapis.com");
      expect(line).not.toContain("https://");
    }
  });

  it("names no count of services — counts rot, names do not", () => {
    for (const line of ALL_INTERSTITIAL_COPY) {
      expect(line.toLowerCase()).not.toMatch(
        /\b(eight|seven|nine|\d+)\s+(google\s+)?services?\b/
      );
    }
  });

  it("teaches the two facts that matter: boxes come unticked, Select all fixes it", () => {
    expect(INTERSTITIAL_EXPLANATION.toLowerCase()).toContain("unticked");
    expect(INTERSTITIAL_EXPLANATION.toLowerCase()).toContain("connects nothing");
    expect(INTERSTITIAL_SELECT_ALL).toBe("Select all");
    expect(INTERSTITIAL_INSTRUCTION).toContain("Select all");
  });
});

describe("the proceed link", () => {
  it("keeps route and page from drifting: the rendered page links what the builder built", () => {
    const url = googleConnectProceedUrl("/dashboard/agent?thread=t1");
    expect(url).toBe(
      "/auth/google/connect?proceed=1&next=%2Fdashboard%2Fagent%3Fthread%3Dt1"
    );
    expect(renderConnectInterstitial("/dashboard/agent?thread=t1")).toContain(
      `href="${url}"`
    );
  });

  it("a hostile next cannot escape the attribute — the renderer encodes it itself", () => {
    // The renderer takes the RAW next and builds the URL internally, so the
    // encoding is structural: there is no way to hand it a pre-built string.
    const html = renderConnectInterstitial('"/><script>x</script>');
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("%3Cscript%3E");
  });

  it("no next means the bare proceed URL", () => {
    expect(googleConnectProceedUrl(null)).toBe("/auth/google/connect?proceed=1");
    expect(renderConnectInterstitial(null)).toContain(
      'href="/auth/google/connect?proceed=1"'
    );
  });
});
