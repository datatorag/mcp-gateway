import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * House style on the Billing page's sources (SCRUM-352), file-wide, comments
 * included: copy-dense files, and comment prose next to copy is what drifts
 * into it. The same rule the pricing copy test holds.
 */

const read = (...segments: string[]) => readFileSync(join(process.cwd(), ...segments), "utf8");

const sources = {
  copy: read("src", "app", "dashboard", "billing", "billing-copy.ts"),
  view: read("src", "app", "dashboard", "billing", "billing-view.tsx"),
  cards: read("src", "components", "plan-cards.tsx"),
  portal: read("src", "components", "portal-action.tsx"),
};

describe("billing copy", () => {
  it("contains no em dashes", () => {
    for (const [name, source] of Object.entries(sources)) {
      expect(source, name).not.toContain("—");
      expect(source, name).not.toContain("&mdash;");
    }
  });

  it("keeps the cancellation sentence", () => {
    expect(sources.copy).toContain("If you cancel, Pro stays active until the end of the period you've paid for.");
  });

  it("publishes no overage rate and promises nothing unbuilt", () => {
    for (const source of Object.values(sources)) {
      expect(source).not.toMatch(/\$0\.0|per[ -]call|overage rate/i);
      expect(source).not.toMatch(/unlimited/i);
    }
  });
});
