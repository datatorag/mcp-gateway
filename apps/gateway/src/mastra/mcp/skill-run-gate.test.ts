import { describe, expect, it } from "vitest";
import { skillRunApproval } from "./skill-run-gate";

/* SCRUM-223 / SCRUM-225, per HQ decision: a skill run is a background
 * process and prompts for nothing mid-run, manual or scheduled, writes
 * included. Consent is the Run click or the schedule save. Safety lives in
 * ordering (reversible before irreversible, which the published skills
 * teach) and in recovery (history, pause), not in gates. There is no
 * exception for any tool; this test is the place one would have to be
 * argued for. */
describe("skillRunApproval: nothing prompts inside a skill run", () => {
  it("clears the approval requirement for every tool, writes included", () => {
    for (const name of [
      "gmail_mark_read",
      "tasks_create",
      "docs_create",
      "gmail_send",
      "gmail_forward",
      "calendar_delete_event",
      "some_unknown_tool",
    ]) {
      expect(skillRunApproval(name), name).toBe(false);
    }
  });
});
