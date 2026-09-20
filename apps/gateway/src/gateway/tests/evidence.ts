import { scrubSensitiveText } from "../usage/redact";

/** 4 KB, and the marker says a truncation happened rather than leaving a
 * sentence that stops mid-word looking like the whole story. */
export const EVIDENCE_CAP = 4096;
export const TRUNCATION_MARKER = "\n... evidence truncated";

/**
 * What a person needs to believe a result (SCRUM-303), and nothing more.
 *
 * It scrubs with `scrubSensitiveText`, the pattern list the usage sink uses,
 * rather than with `redactErrorMessage`: that one also caps at 500
 * characters and rebuilds error envelopes, which is right for an upstream
 * error message and destroys a multi-line evidence block.
 *
 * ONE CONSEQUENCE TO KNOW, AND IT IS A TENSION WITH THE SPEC. The shared
 * pattern list replaces any run of 20 or more word characters with
 * `[redacted-id]`, because that is the shape of a Drive file id, a sheet id
 * and a Gmail message id. Evidence therefore cannot name an artifact by id,
 * while the spec says a leaked cleanup should "name the artifact". Both
 * cannot hold. v1 takes the safe side: over-redaction loses information a
 * person can recover another way, under-redaction is irreversible once the
 * row is written and served by `tests_results`. A leaked cleanup still
 * names the TOOL, the zone and the run stamp, which is enough to find the
 * leftover by listing. HQ owns whether to loosen it.
 *
 * The rule this enforces mechanically is the cap and the scrub. The rule
 * it CANNOT enforce is the important one, so it is stated here for whoever
 * writes a case: evidence records SHAPES AND COMPARISONS, not payloads.
 * "body contains the token: yes", never the body. A run that stored message
 * bodies would be a second copy of a mailbox, sitting in a table that a
 * whole dashboard page renders.
 */
export function formatEvidence(lines: readonly string[]): string {
  const joined = lines.join("\n");
  const redacted = scrubSensitiveText(joined);
  if (redacted.length <= EVIDENCE_CAP) return redacted;
  return redacted.slice(0, EVIDENCE_CAP - TRUNCATION_MARKER.length) + TRUNCATION_MARKER;
}
