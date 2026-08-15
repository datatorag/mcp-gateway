// @vitest-environment jsdom

/**
 * The chat panel meter (SCRUM-94), on a real render: the runs number in the
 * words each account state deserves, and a connector display that shows
 * multi-account rather than implying one-account-per-connector. The exempt
 * state is the case that bites first — the founder is capExempt AND a Pro
 * subscriber — so the strings "null", "NaN", and "Infinity" are asserted
 * absent, not assumed absent.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { planLimits } from "@/gateway/billing/plans";
import { AgentMeter, runsLabel, type AgentQuota } from "./agent-meter";
import type { ConnectedAccount } from "./connections/types";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function account(
  connectorType: string,
  accountEmail: string
): ConnectedAccount {
  return {
    id: `${connectorType}-${accountEmail}`,
    connectorType,
    accountEmail,
    isDefault: false,
  } as ConnectedAccount;
}

function render(
  quota: AgentQuota | null,
  accounts: ConnectedAccount[],
  accountsLoaded = true
) {
  act(() => {
    root.render(
      <AgentMeter
        quota={quota}
        accounts={accounts}
        accountsLoaded={accountsLoaded}
      />
    );
  });
}

describe("runsLabel", () => {
  it("a capped account reads remaining of cap", () => {
    expect(runsLabel({ used: 12, cap: 100, remaining: 88 })).toBe(
      "88 of 100 runs left"
    );
  });

  it("a PRO quota built from planLimits says 100 — the meter half of the SCRUM-84 pin", () => {
    // LITERAL on purpose: if pro's allowance drifts back to 25 in planLimits,
    // this line reddens alongside the plan-table and claim pins. The meter is
    // a persistent on-screen claim; it must go red with the others.
    const cap = planLimits("pro").agentRuns;
    expect(runsLabel({ used: 0, cap, remaining: cap })).toBe(
      "100 of 100 runs left"
    );
  });

  it("an exempt account gets its own words, never null/NaN/Infinity or a fake cap", () => {
    const label = runsLabel({ used: 7, cap: null, remaining: null });
    expect(label).toBe("7 runs this period, no cap on this account");
    for (const banned of ["null", "NaN", "Infinity", "undefined"]) {
      expect(label).not.toContain(banned);
    }
    // And no free-cap fallback smuggled into the copy.
    expect(label).not.toContain("25");
  });
});

describe("AgentMeter", () => {
  it("shows multi-account counts and carries the emails on a native tooltip", () => {
    render({ used: 1, cap: 25, remaining: 24 }, [
      account("google-workspace", "a@example.com"),
      account("google-workspace", "b@example.com"),
      account("atlassian", "c@example.com"),
    ]);
    const text = container.textContent ?? "";
    expect(text).toContain("Google Workspace x2");
    expect(text).toContain("Atlassian");
    expect(text).not.toContain("Atlassian x1");
    const gws = Array.from(container.querySelectorAll("span[title]")).find(
      (s) => s.textContent?.includes("Google Workspace")
    );
    expect(gws?.getAttribute("title")).toBe("a@example.com, b@example.com");
  });

  it("says so when nothing is connected", () => {
    render({ used: 0, cap: 25, remaining: 25 }, []);
    expect(container.textContent).toContain("No connectors connected");
  });

  it("renders nothing at all before either half has loaded", () => {
    render(null, [], false);
    expect(container.textContent).toBe("");
  });

  it("never mentions tool calls — that allowance has no hard stop and this meter must not imply one", () => {
    render({ used: 3, cap: 100, remaining: 97 }, [
      account("google-workspace", "a@example.com"),
    ]);
    expect(container.textContent).not.toMatch(/tool call/i);
  });

  it("contains no em-dashes in any state", () => {
    for (const quota of [
      { used: 3, cap: 100, remaining: 97 },
      { used: 7, cap: null, remaining: null },
    ] as AgentQuota[]) {
      render(quota, [account("atlassian", "c@example.com")]);
      expect(container.textContent).not.toContain("—");
    }
  });
});
