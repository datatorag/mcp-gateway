import { describe, it, expect } from "vitest";

import { GOOGLE_WORKSPACE_SERVICE, serviceGrantStates } from "./scope-grant";
import { serviceFromSlug } from "@/components/service-icon";

/**
 * The join between the grant model and the brand marks (SCRUM-97/106).
 *
 * `serviceGrantStates` hands each service an `iconKey`; `ServiceIcon` renders
 * a mark for keys it knows and a neutral fallback glyph for keys it does not.
 * That fallback is the problem: a key that stops matching does NOT throw, does
 * NOT fail tsc, and does NOT look broken. It quietly renders a grey box where
 * a Gmail logo was, on the one surface whose stated rule is that every service
 * carries its logo.
 *
 * So the join gets a test, and it asks the ICON MODULE rather than holding a
 * second copy of its key list — two lists agreeing with each other is not
 * ground truth, it is drift waiting for one of them to be edited.
 */
describe("grant-model service keys resolve to brand marks", () => {
  it("gives every service an icon key ServiceIcon actually knows", () => {
    const states = serviceGrantStates(GOOGLE_WORKSPACE_SERVICE, null);
    expect(states).toHaveLength(8);
    for (const { displayName, iconKey } of states) {
      expect(
        serviceFromSlug(iconKey),
        `"${displayName}" carries iconKey "${iconKey}", which ServiceIcon ` +
          `does not know — it would render the fallback glyph instead of the ` +
          `brand mark (SCRUM-97).`
      ).toBe(iconKey);
    }
  });

  /** Guards the guard. If `serviceFromSlug` ever degenerated
   * into accepting everything, the assertion above would pass by failing to
   * look. This pins that it still rejects a key that is genuinely absent. */
  it("still rejects a key that has no mark, so the check can go red", () => {
    expect(serviceFromSlug("google-workspace")).toBeNull();
    expect(serviceFromSlug("not-a-service")).toBeNull();
  });
});
