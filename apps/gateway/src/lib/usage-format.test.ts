import { describe, expect, it } from "vitest";

import { formatCost, formatTokens } from "./usage-format";

/** SCRUM-257: the thread's summary line and the usage page say a size and
 * a cost the same way. */
describe("usage formatting (SCRUM-257)", () => {
  it("rounds tokens the way a person reads them", () => {
    expect(formatTokens(0)).toBe("0 tokens");
    expect(formatTokens(900)).toBe("900 tokens");
    expect(formatTokens(4_450)).toBe("4.5k tokens");
    expect(formatTokens(10_000)).toBe("10k tokens");
    expect(formatTokens(184_099)).toBe("184k tokens");
  });

  it("says a cost to the cent, a tiny one as under a cent, and nothing for an unpriced run", () => {
    expect(formatCost(0.99)).toBe("about $0.99");
    expect(formatCost(0.004)).toBe("under $0.01");
    expect(formatCost(0)).toBe("about $0.00");
    expect(formatCost(null)).toBeNull();
  });

  it("carries no dash", () => {
    for (const s of [formatTokens(184_099), formatCost(0.99)!, formatCost(0.004)!]) {
      expect(s).not.toContain("—");
      expect(s).not.toContain("–");
    }
  });
});
