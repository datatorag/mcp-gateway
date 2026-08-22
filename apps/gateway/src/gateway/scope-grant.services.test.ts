import { describe, it, expect } from "vitest";
import {
  GWS_SCOPE_LIST,
  GOOGLE_WORKSPACE_SERVICE,
  scopeDelta,
  serviceGrantStates,
} from "./scope-grant";

/** What Google actually RETURNS for a full grant: the requested list with the
 * identity scopes in their stored long form. Same fixture shape as
 * scope-grant.test.ts, for the same reason — a full production row must not
 * read as partial. */
const FULL_GRANT_AS_GOOGLE_RETURNS_IT = GWS_SCOPE_LIST.map((s) =>
  s === "email" ? "https://www.googleapis.com/auth/userinfo.email" : s
).join(" ");

/** The commonest real shape by a wide margin (per HQ decision, see
 * SCRUM-106): the user reached the consent screen and unticked every service,
 * so only the identity scopes came back. */
const IDENTITY_ONLY = "https://www.googleapis.com/auth/userinfo.email openid";

describe("serviceGrantStates", () => {
  it("marks all eight granted for a full grant", () => {
    const states = serviceGrantStates(
      GOOGLE_WORKSPACE_SERVICE,
      FULL_GRANT_AS_GOOGLE_RETURNS_IT
    );
    expect(states).toHaveLength(8);
    expect(states.every((s) => s.granted)).toBe(true);
  });

  it("marks all eight NOT granted for an identity-only grant", () => {
    const states = serviceGrantStates(GOOGLE_WORKSPACE_SERVICE, IDENTITY_ONLY);
    expect(states).toHaveLength(8);
    expect(states.some((s) => s.granted)).toBe(false);
    expect(states.map((s) => s.displayName)).toEqual([
      "Gmail",
      "Drive",
      "Calendar",
      "Docs",
      "Sheets",
      "Slides",
      "Contacts",
      "Tasks",
    ]);
  });

  it("splits a middle grant into granted and not-granted", () => {
    const states = serviceGrantStates(
      GOOGLE_WORKSPACE_SERVICE,
      [
        "https://www.googleapis.com/auth/userinfo.email",
        "openid",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/drive",
      ].join(" ")
    );
    expect(
      states.filter((s) => s.granted).map((s) => s.displayName)
    ).toEqual(["Gmail", "Drive"]);
    expect(
      states.filter((s) => !s.granted).map((s) => s.displayName)
    ).toEqual(["Calendar", "Docs", "Sheets", "Slides", "Contacts", "Tasks"]);
  });

  /** The two halves must describe the SAME grant. They are computed from one
   * list in one module precisely so they cannot disagree, and a test that only
   * checked `serviceGrantStates` would not notice if they started to. */
  it("agrees with scopeDelta on every service, for every fixture", () => {
    for (const granted of [
      FULL_GRANT_AS_GOOGLE_RETURNS_IT,
      IDENTITY_ONLY,
      "https://www.googleapis.com/auth/tasks openid",
    ]) {
      const delta = scopeDelta(GOOGLE_WORKSPACE_SERVICE, granted);
      const states = serviceGrantStates(GOOGLE_WORKSPACE_SERVICE, granted);
      const missingNames = delta.missing.map((m) => m.displayName).sort();
      const notGrantedNames = states
        .filter((s) => !s.granted)
        .map((s) => s.displayName)
        .sort();
      expect(notGrantedNames).toEqual(missingNames);
      expect(states.every((s) => s.granted)).toBe(delta.complete);
    }
  });

  /** Fail-open, matching scopeDelta: a legacy row this module knows nothing
   * about must not render eight red chips at a user whose connection works. */
  it("reports a null grant as fully granted, like scopeDelta does", () => {
    const states = serviceGrantStates(GOOGLE_WORKSPACE_SERVICE, null);
    expect(states.every((s) => s.granted)).toBe(true);
  });

  /** No other connector has a per-scope opt-out, so there is no per-service
   * story to tell. Empty, never a fabricated all-green list. */
  it("returns nothing for a non-Google service", () => {
    expect(serviceGrantStates("atlassian", null)).toEqual([]);
    expect(serviceGrantStates("atlassian", "read:jira-work")).toEqual([]);
  });

  /** Scope URLs never reach a user, so they must not be on the object a
   * component renders from. Asserted on the payload rather than trusted to
   * component review, because the leak would be one careless `{...state}`. */
  it("carries no scope URL on the rendered shape", () => {
    const serialized = JSON.stringify(
      serviceGrantStates(GOOGLE_WORKSPACE_SERVICE, IDENTITY_ONLY)
    );
    expect(serialized).not.toContain("googleapis.com");
    expect(serialized).not.toContain("https://");
  });
});
