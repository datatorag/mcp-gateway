import { describe, expect, it } from "vitest";
import { checkExpectedChannel, checkExpectedUser } from "./expected-target.js";

/* The expected-target guard: a write goes out only when the target it
 * resolved to is the one the caller named in words. */

describe("checkExpectedChannel", () => {
  it("expected name matches ignoring # and case", () => {
    const resolved = { id: "C000TEST3", name: "smoke-tests" };
    for (const expected of ["smoke-tests", "#smoke-tests", "#Smoke-Tests", "SMOKE-TESTS", "  #smoke-tests  "]) {
      expect(() => checkExpectedChannel(resolved, expected), expected).not.toThrow();
    }
  });

  it("a different channel is refused, naming the resolved one", () => {
    const resolved = { id: "C000TEST1", name: "general" };
    expect(() => checkExpectedChannel(resolved, "#smoke-tests")).toThrow(/#general \(C000TEST1\)/);
    expect(() => checkExpectedChannel(resolved, "#smoke-tests")).toThrow(/nothing was sent/i);
  });

  it("a near name is not a match", () => {
    const resolved = { id: "C000TEST1", name: "general" };
    for (const expected of ["general2", "gen", "#general-archive", "##general", ""]) {
      expect(() => checkExpectedChannel(resolved, expected), expected).toThrow();
    }
  });
});

describe("checkExpectedUser", () => {
  it("matches the email ignoring case and surrounding space", () => {
    expect(() => checkExpectedUser("test.one@example.test", " Test.One@Example.test ")).not.toThrow();
  });

  it("a different email is refused, naming the resolved one", () => {
    expect(() => checkExpectedUser("test.two@example.test", "test.one@example.test", "U000TEST2")).toThrow(
      /test\.two@example\.test.*U000TEST2|U000TEST2.*test\.two@example\.test/
    );
  });

  it("a person whose email Slack withholds cannot be checked, so is refused", () => {
    expect(() => checkExpectedUser(null, "test.one@example.test", "U000TEST1")).toThrow(/did not give/);
  });

  it("an empty expectation is refused", () => {
    expect(() => checkExpectedUser("test.one@example.test", "")).toThrow();
  });
});
