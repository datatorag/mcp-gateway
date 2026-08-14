import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

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
