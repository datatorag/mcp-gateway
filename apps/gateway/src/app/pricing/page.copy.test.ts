import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FREE_MONTHLY_AGENT_RUNS,
  FREE_MONTHLY_CAP,
  PRO_MONTHLY_INCLUDED,
  planLimits,
} from "@/gateway/billing/plans";
import { PRO_RUNS_BULLET, freeAllowanceBullet, proAllowanceBullet } from "./allowances";

/**
 * Accuracy pins for the published pricing copy. Each rule here is
 * one we have been burned by, and each is mechanical — a fixed token that is
 * present or absent — which is the only kind of claim a test can hold; the
 * judgment calls (what a tier may promise) stay in review.
 */

const read = (...segments: string[]) =>
  readFileSync(join(process.cwd(), ...segments), "utf8");

const page = read("src", "app", "pricing", "page.tsx");
const ctas = read("src", "app", "pricing", "pricing-ctas.tsx");
const allowances = read("src", "app", "pricing", "allowances.ts");
const comparisonPost = read(
  "content",
  "blog",
  "composio-vs-pipedream.md"
);

describe("pricing page copy", () => {
  it("contains no trial language — the concept was deleted, not reworded", () => {
    // There is no trial in the product: no trial plan, no trial column, no
    // time-boxed anything. The free tier is the trial. Copy resurrecting the
    // word would describe a product state that cannot occur.
    expect(page).not.toMatch(/trial/i);
    expect(ctas).not.toMatch(/trial/i);
  });

  it("does not name the third tier 'Scale' — it is Enterprise", () => {
    expect(page).not.toMatch(/\bScale\b/);
  });

  it("does not publish an overage rate — metered overage is not built", () => {
    // A published per-call rate we cannot bill is a claim, not a price.
    expect(page).not.toMatch(/\$0\.0|per[ -]call|overage/i);
    expect(ctas).not.toMatch(/\$0\.0|per[ -]call|overage/i);
  });

  it("renders call allowances from billing/plans.ts, not literals", () => {
    // The numbers the page shows must be the numbers enforcement reads.
    expect(page).toContain("FREE_MONTHLY_CAP");
    expect(page).toContain("PRO_MONTHLY_INCLUDED");
    expect(page).not.toMatch(/["`']2,000|["`']250/);
  });

  it("pins the dollar amounts the checkout charges", () => {
    // $20 monthly / $200 yearly, verified against the live Stripe price
    // objects (unit_amount 2000 / 20000, USD) on 2026-08-14. If the Stripe
    // prices ever change, this test is the reminder that the copy is a COPY
    // of that truth and must be re-verified against it, not just re-worded.
    expect(ctas).toContain('"$20"');
    expect(ctas).toContain('"$200"');
    expect(page).toContain("$20 a month or $200 a year");
  });

  it("keeps the claims that must not be weakened", () => {
    expect(page).toContain("Every tier gets the full gateway");
    expect(page).toContain("no per-connector upsell");
    expect(page).toContain("Multi-account");
    expect(page).toContain("Approval gate");
  });

  /* SCRUM-290. "Runs included" with no number read as unmetered, and the
   * allowance is finite and enforced. The cards now state it, from the same
   * plan table enforcement reads. */
  it("the Free and Pro cards state the run allowance that billing/plans.ts enforces", () => {
    const free = planLimits("free");
    const pro = planLimits("pro");
    // Built from the plan table, whatever it holds.
    expect(freeAllowanceBullet()).toBe(
      `${free.monthlyIncluded.toLocaleString("en-US")} tool calls and ${free.agentRuns.toLocaleString("en-US")} agent runs a month, then a hard stop, never a surprise bill`
    );
    expect(proAllowanceBullet()).toBe(
      `${pro.monthlyIncluded.toLocaleString("en-US")} tool calls and ${pro.agentRuns.toLocaleString("en-US")} agent runs a month included`
    );
    expect(free.monthlyIncluded).toBe(FREE_MONTHLY_CAP);
    expect(free.agentRuns).toBe(FREE_MONTHLY_AGENT_RUNS);
    expect(pro.monthlyIncluded).toBe(PRO_MONTHLY_INCLUDED);
    // Free is a hard stop and says so; the word must go if that ever changes.
    expect(free.hardCap).toBe(true);
  });

  it("pins the published sentences, so a change to a plan number is a change someone reads", () => {
    // The test above would pass for ANY numbers. These are the words on the
    // page today; when plans.ts moves, this fails and the copy (and any image
    // or email quoting it) gets re-read rather than silently re-rendered.
    expect(freeAllowanceBullet()).toBe("250 tool calls and 25 agent runs a month, then a hard stop, never a surprise bill");
    expect(proAllowanceBullet()).toBe("2,000 tool calls and 100 agent runs a month included");
    expect(PRO_RUNS_BULLET).toBe("Skill and agent runs come out of that, no separate bill for the model");
  });

  it("the page renders those bullets, in order on the Pro card, and holds no run count of its own", () => {
    expect(page).toContain("freeAllowanceBullet(),");
    const pro = page.slice(page.indexOf('name: "Pro"'), page.indexOf('name: "Enterprise"'));
    // "that" in the second bullet refers to the first, so the order is copy.
    expect(pro.indexOf("proAllowanceBullet(),")).toBeGreaterThan(-1);
    expect(pro.indexOf("PRO_RUNS_BULLET,")).toBeGreaterThan(pro.indexOf("proAllowanceBullet(),"));
    const freeCard = page.slice(page.indexOf('name: "Free"'), page.indexOf('name: "Pro"'));
    expect(freeCard).not.toContain("PRO_RUNS_BULLET");
    // No literal allowance anywhere in the page or the helper.
    for (const source of [page, allowances]) {
      expect(source).not.toMatch(/\d[\d,]* (tool calls|agent runs)/);
    }
    expect(page).not.toMatch(/unlimited/i);
    expect(allowances).not.toMatch(/unlimited/i);
  });

  it("Enterprise copy promises nothing we would have to build", () => {
    // The tier name is ruled; what would commit us operationally is copy.
    // Quote-only means no self-serve promises: none of these may appear.
    for (const banned of [/\bSSO\b/, /\bSAML\b/, /\bDPA\b/, /SOC ?2/i, /\bSLA/i, /dedicated support/i, /invoicing|PO terms/i]) {
      expect(page).not.toMatch(banned);
      expect(ctas).not.toMatch(banned);
    }
  });

  it("contains no em-dashes (house style)", () => {
    // File-wide on purpose, comments included: these files are copy-dense,
    // and comment prose next to copy is exactly what drifts into it.
    for (const source of [page, ctas]) {
      expect(source).not.toContain("—");
      expect(source).not.toContain("&mdash;");
    }
  });
});

describe("comparison post pricing claims", () => {
  it("no longer names the retired 'Scale' tier or an unbuilt usage meter", () => {
    expect(comparisonPost).not.toMatch(/\bScale\b/);
    expect(comparisonPost).not.toMatch(/usage-based pricing/i);
  });
});
