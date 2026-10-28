/**
 * Which cases hold the file-transfer lock (SCRUM-428). Read from the real
 * case list, so a new case that moves a file is held without anyone adding
 * it here, and a case that does not is never slowed by it.
 */
import { describe, expect, it } from "vitest";
import { CASES } from "./cases";
import { movesAFile } from "./execute";

describe("the file-transfer lock", () => {
  it("is held by every case that moves a file, in whichever scenario", () => {
    const held = CASES.filter(movesAFile).map((c) => c.id);
    // The four that met the gateway's one-transfer refusal in run 103bb1d2,
    // and the others that move a file, across the Gmail, Drive and Jira
    // scenarios.
    for (const id of ["DR6", "FD3", "FD4", "FD5", "FD1", "JR8", "JR10", "JR13", "FD10", "FD11", "FD12", "FD13", "FD14", "FD15", "FD16", "FD17", "FD18", "DR7"]) {
      expect(held, id).toContain(id);
    }
  });

  it("is not held by a case that moves no file", () => {
    const held = new Set(CASES.filter(movesAFile).map((c) => c.id));
    for (const id of ["D10", "DR5", "C11", "CA5"]) expect(held.has(id), id).toBe(false);
  });

  it("is held by a case that moves a file only on some runs, through cleanupCalls", () => {
    // DR7 uploads its standing fixture only when it is missing: setup, not
    // coverage, so the upload is a cleanupCall and still takes the lock.
    expect(movesAFile({ covers: [], cleanupCalls: ["gws-mcp__drive_upload_file"] })).toBe(true);
  });
});
