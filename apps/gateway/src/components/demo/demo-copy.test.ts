import { describe, expect, it } from "vitest";
import { FREE_MONTHLY_AGENT_RUNS } from "@/gateway/billing/plans";
import { DEMO_DISCLOSURE } from "./demo-bento";
import {
  DEMO_CTA_ACTION,
  DEMO_CTA_SUPPORT,
  DEMO_HEADING,
  DEMO_STANDFIRST,
  expectedRunWord,
} from "./demo-copy";

const ALL = [DEMO_HEADING, ...DEMO_STANDFIRST, DEMO_CTA_ACTION, DEMO_CTA_SUPPORT];

describe("demo section copy", () => {
  it("promises the allowance the code actually grants", () => {
    // THE ONE THAT MATTERS. The CTA spells the number in words, so it cannot
    // interpolate the constant and is a hand-copied figure on the page with the
    // widest reach we have. If someone changes the free run allowance and not
    // this sentence, the page promises an allowance the product refuses, which
    // the user meets as a hard stop mid-task. That is a bait and switch even
    // when it is an accident.
    const word = expectedRunWord();
    expect(
      word,
      `no spelling mapped for a cap of ${FREE_MONTHLY_AGENT_RUNS}; add it to NUMBER_WORDS and fix the CTA`
    ).toBeDefined();
    expect(DEMO_CTA_SUPPORT).toContain(word!);
  });

  it("keeps that check honest", () => {
    // The guard above passes by finding a word in a sentence, so it would also
    // pass if the sentence were rewritten around a different number while
    // happening to retain the mapped one. Assert the sentence does not name a
    // DIFFERENT allowance at the same time.
    const others = Object.entries({ ten: 10, twenty: 20, fifty: 50 })
      .filter(([, n]) => n !== FREE_MONTHLY_AGENT_RUNS)
      .map(([w]) => w);
    for (const w of others) {
      // "twenty-five" contains "twenty", so match on a word boundary that a
      // hyphen does not satisfy.
      expect(DEMO_CTA_SUPPORT).not.toMatch(new RegExp(`\\b${w}\\b(?!-)`));
    }
  });

  it("does not offer bring-your-own-key", () => {
    // Deferred. At launch the cap has two exits, upgrade or your own client.
    // Copy promising a third ships before the exit does.
    for (const line of ALL) {
      expect(line.toLowerCase()).not.toMatch(
        /\b(byok|api key|your own key|bring your own)\b/
      );
    }
  });

  it("contains no em-dashes", () => {
    for (const line of ALL) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("&mdash;");
    }
  });

  it("calls the surface Agent, not playground", () => {
    // Includes the disclosure, which is the one string in this section that a
    // rename must touch and must otherwise leave completely alone.
    for (const line of [...ALL, DEMO_DISCLOSURE]) {
      expect(line.toLowerCase()).not.toContain("playground");
    }
  });

  it("keeps the disclosure doing its safety work", () => {
    // The rename was allowed exactly one word. This pins the parts that carry
    // the meaning: that the windows are a REPLAY, that the data is SAMPLE data,
    // and that the approval gate shown is real. A future tidy-up that shortens
    // this sentence turns a recording presented as such into a recording
    // presented as a live session.
    expect(DEMO_DISCLOSURE).toContain("scripted replay");
    expect(DEMO_DISCLOSURE).toContain("sample data");
    expect(DEMO_DISCLOSURE).toContain("approval gate");
    expect(DEMO_DISCLOSURE).toContain("Agent UI");
  });
});
