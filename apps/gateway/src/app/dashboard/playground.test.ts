import { describe, expect, it } from "vitest";

import { GENERIC_ERROR_MESSAGE } from "@/lib/errors";
import { GENERIC_ERROR, errorBubbleText } from "./playground";

/**
 * The playground error bubble has to do one subtle thing: pass a genuinely
 * actionable, server-authored message through verbatim, while normalising
 * every non-actionable failure — whether the client or the server produced
 * it — to a single canonical string.
 *
 * This is the only test in the suite that asserts on user-facing copy, and it
 * exists for a specific reason: the "two different generic error strings"
 * defect shipped TWICE, passing tsc, the build, and 213 tests both times,
 * because nothing anywhere compared these strings.
 *
 * The drift protection is the whole point, so NO assertion below hardcodes a
 * generic string: `GENERIC_ERROR` comes from the component and
 * `GENERIC_ERROR_MESSAGE` from `src/lib/errors.ts` (the value
 * `logAndGenericError` actually returns). If either wording is retuned, these
 * tests keep asserting the real relationship instead of passing against a
 * stale copy. The one hardcoded literal is the expired-confirmation notice —
 * that one is deliberate, since proving it survives VERBATIM is the point.
 */
describe("errorBubbleText", () => {
  it("distinguishes the client and server generic strings", () => {
    // Guards the premise of every other case here: these are two different
    // strings, which is exactly why the normalisation below is needed. If they
    // are ever unified upstream, this fails and the rest can be simplified.
    expect(GENERIC_ERROR).not.toBe(GENERIC_ERROR_MESSAGE);
  });

  describe("falls back to the canonical copy", () => {
    // The component only calls this with a defined error, but the signature
    // accepts `undefined`, so the contract is pinned.
    const cases: [name: string, input: Error | undefined][] = [
      ["no error at all", undefined],
      ["an empty message", new Error("")],
      ["a whitespace-only message", new Error("   \n\t  ")],
      ["the server's non-actionable placeholder", new Error(GENERIC_ERROR_MESSAGE)],
      [
        "the server's placeholder with incidental whitespace",
        new Error(`  ${GENERIC_ERROR_MESSAGE}  `),
      ],
    ];

    for (const [name, input] of cases) {
      it(name, () => {
        expect(errorBubbleText(input)).toBe(GENERIC_ERROR);
      });
    }
  });

  describe("passes actionable server copy through verbatim", () => {
    it("keeps the expired-confirmation notice", () => {
      // Written straight to the stream by the chat route's `handleResume`,
      // bypassing `logAndGenericError` — it tells the user what to do next, so
      // replacing it with the generic copy would lose the instruction.
      const expired = "This confirmation expired — please run the prompt again.";
      expect(errorBubbleText(new Error(expired))).toBe(expired);
    });

    it("keeps any other server-authored message", () => {
      expect(errorBubbleText(new Error("Connect Google Workspace first."))).toBe(
        "Connect Google Workspace first."
      );
    });

    it("trims surrounding whitespace", () => {
      expect(errorBubbleText(new Error("  Try a shorter prompt.  "))).toBe(
        "Try a shorter prompt."
      );
    });
  });
});
