import { describe, expect, it } from "vitest";
import { CASES } from "@/gateway/tests/cases";
import { FIXTURE_KEYS } from "@/gateway/tests/types";
import { PUBLIC_TITLES } from "./public-titles";
import { GATE_CASE_ID } from "./read-model";

/** Public titles are public copy (SCRUM-431): every case has one, and none
 * carries anything a status page must not say. */
describe("public titles", () => {
  it("exist for every registered case and the runner's gate row, and for nothing else", () => {
    expect(Object.keys(PUBLIC_TITLES).sort()).toEqual([...CASES.map((c) => c.id), GATE_CASE_ID].sort());
  });

  it.each(Object.entries(PUBLIC_TITLES))("%s carries no ticket id, email, em dash, fixture key or tool count", (_id, title) => {
    expect(title.trim()).not.toBe("");
    expect(title).not.toMatch(/\b[A-Z]+-\d+\b/);
    expect(title).not.toMatch(/@/);
    expect(title).not.toContain(String.fromCharCode(0x2014));
    // Fixture keys are camelCase names (smokeMessage, querySheet). The plain
    // words some of them also are (doc, folder) are allowed.
    for (const key of FIXTURE_KEYS.filter((k) => /[a-z][A-Z]/.test(k))) expect(title).not.toContain(key);
    expect(title).not.toMatch(/\b\d+\+?\s+tools?\b/i);
  });
});
