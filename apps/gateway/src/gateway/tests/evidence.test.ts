/**
 * Evidence is capped and redacted before it is written (SCRUM-303).
 */

import { describe, expect, it } from "vitest";
import { EVIDENCE_CAP, TRUNCATION_MARKER, formatEvidence } from "./evidence";

describe("formatEvidence", () => {
  it("joins the lines a case recorded", () => {
    expect(formatEvidence(["expected 3 ranges", "got 2"])).toBe("expected 3 ranges\ngot 2");
  });

  /** Realistic evidence: prose and short numbers. A long unbroken run of
   * word characters is an ID to the scrub, not a sentence, so filler made of
   * one repeated letter would be testing the scrub rather than the cap. */
  const line = (n: number) => `step ${n}: expected 3 ranges, got 3, took 41 ms`;
  const manyLines = Array.from({ length: 400 }, (_, i) => line(i));

  it("caps at 4 KB and says that it did", () => {
    const out = formatEvidence(manyLines);
    expect(out.length).toBe(EVIDENCE_CAP);
    expect(out.endsWith(TRUNCATION_MARKER)).toBe(true);
  });

  it("leaves a block under the cap alone", () => {
    const out = formatEvidence([line(1), line(2)]);
    expect(out).toBe(`${line(1)}\n${line(2)}`);
    expect(out).not.toContain(TRUNCATION_MARKER);
  });

  it("does not inherit redactErrorMessage's 500-character cap", () => {
    // The reason this module scrubs rather than calling redactErrorMessage:
    // that one caps at 500, so a legitimate evidence block was cut to a
    // fifth of its allowance before the 4 KB cap ever applied.
    const out = formatEvidence(Array.from({ length: 30 }, (_, i) => line(i)));
    expect(out.length).toBeGreaterThan(1000);
    expect(out).not.toContain(TRUNCATION_MARKER);
  });

  it("redacts an artifact id, which is the tension with naming a leftover", () => {
    // Pinned so the tradeoff is visible rather than discovered. Any run of
    // 20+ word characters is an id to the shared pattern list, so a Drive or
    // sheet id in evidence becomes a marker. A leaked cleanup therefore
    // names the tool, the zone and the run stamp instead. HQ owns whether to
    // loosen this; loosening it is the irreversible direction.
    const out = formatEvidence(["created file Ab3xYz9Qw7Lm2Kp5Rt8Nv1 in the fixture folder"]);
    expect(out).not.toContain("Ab3xYz9Qw7Lm2Kp5Rt8Nv1");
    expect(out).toContain("[redacted-id]");
    expect(out).toContain("in the fixture folder");
  });

  it("masks a token-shaped string through the shared pattern list", () => {
    // Evidence is rendered on an admin page and returned by a tool, so a
    // credential that reached a case's error message must not survive into
    // the row. The pattern list lives in usage/redact.ts and is shared with
    // the usage sink rather than copied here.
    const out = formatEvidence(["upstream said: Bearer ya29.a0ARrdaM-FAKE-TOKEN-VALUE-0123456789"]);
    expect(out).not.toContain("ya29.a0ARrdaM-FAKE-TOKEN-VALUE-0123456789");
  });

  it("gives an empty string for no lines rather than undefined", () => {
    expect(formatEvidence([])).toBe("");
  });
});

/**
 * The scrub ate things a reader needs (SCRUM-303).
 *
 * The shared pattern list replaces any run of 20+ word characters with
 * `[redacted-id]`, which is right for a Drive id and wrong for
 * `gws-mcp__sheets_query` at 21 characters: the skip reason "this run does
 * not serve gws-mcp__sheets_query" arrived naming nothing. Same for the
 * fixture address a send refusal names. The fix holds those tokens back
 * rather than loosening the pattern, because loosening it would loosen it
 * for real ids too.
 */
describe("tokens the scrub must not eat", () => {
  const TOOL = "gws-mcp__sheets_query";
  const ADDRESS = "reader@example.test";

  it("keeps a served tool name in a skip reason", () => {
    const out = formatEvidence([`this run does not serve ${TOOL}`], [TOOL]);
    expect(out).toContain(TOOL);
    expect(out).not.toContain("[redacted-id]");
  });

  it("keeps a configured address in a send refusal", () => {
    const out = formatEvidence([`refused: may only send to ${ADDRESS}`], [ADDRESS]);
    expect(out).toContain(ADDRESS);
  });

  it("STILL redacts an id that is not on the safe list", () => {
    // The half that proves the fix did not just turn the scrub off.
    const out = formatEvidence([`created 1SyntheticFixtureIdNotARealSheet0123456789ab`], [TOOL]);
    expect(out).toContain("[redacted-id]");
    expect(out).not.toContain("1SyntheticFixture");
  });

  it("STILL redacts an address that is not configured", () => {
    const out = formatEvidence([`mail from stranger@elsewhere.test`], [ADDRESS]);
    expect(out).toContain("[redacted-email]");
    expect(out).not.toContain("stranger@elsewhere.test");
  });

  it("protects the longer token when one safe token contains another", () => {
    const out = formatEvidence(
      ["gws-mcp__sheets_read and gws-mcp__sheets_read_extra_long_name"],
      ["gws-mcp__sheets_read", "gws-mcp__sheets_read_extra_long_name"]
    );
    expect(out).toContain("gws-mcp__sheets_read_extra_long_name");
  });

  it("FAILS CLOSED when the text already carries the sentinel", () => {
    // Restoring could otherwise corrupt the line, so nothing is protected
    // and everything is scrubbed. Over-redaction, never under.
    const out = formatEvidence([`«0» saw ${TOOL}`], [TOOL]);
    expect(out).toContain("[redacted-id]");
    expect(out).not.toContain(TOOL);
  });

  it("scrubs normally when nothing is declared safe", () => {
    expect(formatEvidence([`serve ${TOOL}`])).toContain("[redacted-id]");
  });
});
