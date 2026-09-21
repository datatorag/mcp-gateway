/**
 * The scenario registry cannot drift from the suite (SCRUM-303).
 *
 * The regroup moves 54 cases into twelve lifecycles one commit at a time.
 * The failure mode that matters during a move like this is not a wrong
 * answer, it is a SILENT one: a case that belongs to no scenario still runs
 * under "run everything" and passes, while being unreachable from any
 * scenario control and invisible in the scenario report. Nobody notices
 * until someone asks why the Sheets lifecycle never touched find_rows.
 *
 * So placed and pending are asserted against each other, both directions,
 * and the pending list shrinks to empty as the regroup lands.
 */

import { describe, expect, it } from "vitest";
import { CASES } from "./cases";
import {
  REGROUP_PENDING,
  SCENARIOS,
  SCENARIO_KEYS,
  scenarioOf,
  stepNumber,
} from "./scenarios";
import { sendsMail } from "@/app/dashboard/admin/tests/runs-panel";

const ids = CASES.map((c) => c.id);
const placed = SCENARIOS.flatMap((s) => s.steps);

describe("every case has exactly one home", () => {
  it("names only cases that exist", () => {
    // A typo here would silently drop a step from its lifecycle, since a
    // missing id selects nothing rather than failing.
    const unknown = placed.filter((id) => !ids.includes(id));
    expect(unknown, `scenario steps naming no registered case: ${unknown.join(", ")}`).toEqual([]);
  });

  it("places no case in two scenarios", () => {
    const seen = new Set<string>();
    const twice = placed.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
    expect(twice, `cases placed more than once: ${twice.join(", ")}`).toEqual([]);
  });

  it("accounts for every registered case, as placed or as pending", () => {
    const covered = new Set([...placed, ...REGROUP_PENDING]);
    const homeless = ids.filter((id) => !covered.has(id));
    expect(homeless, `cases in no scenario and not pending: ${homeless.join(", ")}`).toEqual([]);
  });

  it("lists nothing as pending that is already placed", () => {
    const both = REGROUP_PENDING.filter((id) => placed.includes(id));
    expect(both, `listed as pending while already in a scenario: ${both.join(", ")}`).toEqual([]);
  });

  it("lists nothing as pending that is not a registered case", () => {
    const ghosts = REGROUP_PENDING.filter((id) => !ids.includes(id));
    expect(ghosts, `pending ids with no case: ${ghosts.join(", ")}`).toEqual([]);
  });
});

describe("the registry's own shape", () => {
  it("declares each scenario once, in the order the keys are listed", () => {
    /* Not `new Set(keys).size === keys.length`, which is true by
     * construction while one scenario is registered, and not
     * `SCENARIO_KEYS contains k`, which the type already guarantees so a
     * violation is a compile error rather than a red test. What can
     * actually go wrong is a scenario landing out of order during the
     * regroup, since the order IS the run order. */
    const keys = SCENARIOS.map((s) => s.key);
    expect(new Set(keys).size, `duplicate scenario keys: ${keys.join(", ")}`).toBe(keys.length);
    const expected = SCENARIO_KEYS.filter((k) => keys.includes(k));
    expect(keys).toEqual(expected);
    /* The tripwire that used to sit here has done its job. Both assertions
     * above were vacuous while one scenario was registered, and it failed
     * the moment a second landed so they would be reconsidered rather than
     * left decorative. They are real now: two keys can collide, and two can
     * be declared out of order, which matters because the order here IS the
     * order scenarios run in. */
    expect(keys.length, "at least two scenarios, so the assertions above can fail").toBeGreaterThan(1);
  });

  it("gives every scenario a title and at least one step", () => {
    for (const s of SCENARIOS) {
      expect(s.title.trim(), `${s.key} has no title`).not.toBe("");
      expect(s.steps.length, `${s.key} has no steps`).toBeGreaterThan(0);
    }
  });

  it("answers which scenario a case is in, and where in it", () => {
    const first = SCENARIOS[0];
    expect(scenarioOf(first.steps[0])?.key).toBe(first.key);
    expect(stepNumber(first.steps[0])).toBe(1);
    expect(stepNumber(first.steps[first.steps.length - 1])).toBe(first.steps.length);
  });

  it("says nothing about a case that is not placed", () => {
    expect(scenarioOf("NOT-A-CASE")).toBeUndefined();
    expect(stepNumber("NOT-A-CASE")).toBeUndefined();
  });
});

/**
 * The mail flag is a safety control, not a label: it decides which words a
 * person reads before starting something that reaches an inbox. Asserted in
 * BOTH directions so it cannot quietly spread to scenarios that send
 * nothing, which is how the old tier-wide warning stopped being read.
 */
describe("the sends-mail flag", () => {
  it("is set on gmail and nowhere else", () => {
    /* HALF OF THIS IS VACUOUS UNTIL GMAIL IS REGROUPED, and saying so is
     * the point: the first version was only ever the "nowhere else" half,
     * it passed green, and the product's mail warning was wrong at the same
     * time. The gmail half is asserted separately below so it cannot hide
     * inside a loop that does not run. */
    for (const s of SCENARIOS) {
      expect(s.sendsMail === true, `${s.key} must not claim to send mail`).toBe(s.key === "gmail");
    }
  });

  it("is set on gmail once gmail exists", () => {
    const gmail = SCENARIOS.find((s) => s.key === "gmail");
    if (!gmail) {
      expect(REGROUP_PENDING, "gmail is unregistered, so its cases must still be pending").toContain("D10");
      return;
    }
    expect(gmail.sendsMail, "the gmail scenario must declare that it sends mail").toBe(true);
  });
});

/**
 * THE WARNING A PERSON READS BEFORE STARTING SOMETHING THAT REACHES AN
 * INBOX. Pinned here rather than only in the panel's own suite, because the
 * bug was not in the component: "everything" derived its warning from the
 * scenario flags while every mail case was still pending, so the run that
 * sends the most mail was the one that stopped warning about it.
 */
describe("what the everything-run warns about", () => {
  it("assumes mail while any case is still unplaced", () => {
    expect(REGROUP_PENDING.length, "this test is about the regroup being unfinished").toBeGreaterThan(0);
    expect(sendsMail("all")).toBe(true);
  });

  it("does not warn for a scenario that sends nothing, nor for an unknown one", () => {
    /* BOTH HALVES ARE NEGATIVE, and the title says so rather than promising
     * coverage that does not exist: no registered scenario sends mail yet,
     * so the positive half cannot be written until Gmail is regrouped. A
     * title that oversells is how a reader stops reading the assertions. */
    expect(sendsMail("gateway")).toBe(false);
    expect(sendsMail("nope")).toBe(false);
  });

  it("still knows the mail cases are in this run", () => {
    // The concrete reason the assumption above is not paranoia.
    for (const id of ["D10", "D11", "D12", "D13"]) {
      expect(REGROUP_PENDING, `${id} still runs under everything`).toContain(id);
    }
  });
});
