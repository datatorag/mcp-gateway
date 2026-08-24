import { describe, expect, it } from "vitest";
import {
  ALL_GRANT_COPY,
  GRANT_NONE_GRANTED,
  GRANT_RECONNECT_LABEL,
} from "./grant-copy";
import {
  GRANT_STATE_LABEL,
  GRANT_STATE_VARIANT,
  grantState,
  suggestBetterDefault,
} from "./grant-state";
import type { ScopeStatus } from "./types";

const services = (grantedNames: string[]) =>
  [
    "Gmail",
    "Drive",
    "Calendar",
    "Docs",
    "Sheets",
    "Slides",
    "Contacts",
    "Tasks",
  ].map((displayName) => ({
    displayName,
    iconKey: displayName.toLowerCase(),
    granted: grantedNames.includes(displayName),
  }));

const status = (grantedNames: string[]): ScopeStatus => ({
  missing: services(grantedNames)
    .filter((s) => !s.granted)
    .map((s) => ({ scope: `scope:${s.iconKey}`, displayName: s.displayName })),
  complete: grantedNames.length === 8,
  services: services(grantedNames),
});

const ALL = [
  "Gmail",
  "Drive",
  "Calendar",
  "Docs",
  "Sheets",
  "Slides",
  "Contacts",
  "Tasks",
];

describe("grant panel copy", () => {
  it("contains no em-dashes", () => {
    for (const line of ALL_GRANT_COPY) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("&mdash;");
    }
  });

  /** A scope URL rendered to a user is the thing this whole module exists to
   * avoid. The disclosure shows raw values only on an explicit click; none of
   * the always-visible copy may carry one. */
  it("never carries a scope URL", () => {
    for (const line of ALL_GRANT_COPY) {
      expect(line).not.toContain("googleapis.com");
      expect(line).not.toContain("https://");
    }
  });

  /** A claim with a number only survives while the number does. Adding
   * or dropping a scope must not silently turn this copy into a lie. */
  it("names no count of services", () => {
    for (const line of ALL_GRANT_COPY) {
      expect(line.toLowerCase()).not.toMatch(
        /\b(eight|seven|nine|all eight|\d+)\s+(google\s+)?services?\b/
      );
    }
  });

  /** The one-click requirement is a copy fact as well as a layout one: the
   * label has to promise the grant, not just a reconnection. */
  it("promises the grant on the control, not just a reconnect", () => {
    expect(GRANT_RECONNECT_LABEL.toLowerCase()).toContain("grant");
  });

  /** The commonest state has to state the consequence, or it is a status with
   * no meaning attached. */
  it("says what a fully-declined grant costs the user", () => {
    // The consequence, not just the status. The negation rides on "no Google
    // tools" rather than on "cannot", so this asserts the clause, not a word.
    expect(GRANT_NONE_GRANTED.toLowerCase()).toContain("no google tools can run");
  });

  it("keeps its own rules honest", () => {
    // A pattern guard that stopped matching would pass by failing to
    // look. These are the strings the rules above must reject.
    const emDash = "granted — mostly";
    const url = "https://www.googleapis.com/auth/drive";
    const counted = "all eight services granted";
    expect(emDash).toContain("—");
    expect(url).toContain("googleapis.com");
    expect(counted.toLowerCase()).toMatch(
      /\b(eight|seven|nine|all eight|\d+)\s+(google\s+)?services?\b/
    );
  });
});

describe("grantState", () => {
  it("reads a full grant as complete", () => {
    expect(grantState(status(ALL), true)).toBe("complete");
  });

  /** The case the ticket is really about: connected, and granted nothing. */
  it("reads an identity-only grant as none, not partial", () => {
    expect(grantState(status([]), true)).toBe("none");
  });

  it("reads a mixed grant as partial", () => {
    expect(grantState(status(["Gmail", "Drive"]), true)).toBe("partial");
    expect(grantState(status(ALL.slice(0, 7)), true)).toBe("partial");
  });

  it("reads no connection as disconnected regardless of status", () => {
    expect(grantState(status([]), false)).toBe("disconnected");
    expect(grantState(undefined, false)).toBe("disconnected");
  });

  /** Fail-open, matching scopeDelta: an unknown row must not nag a user whose
   * connection works. */
  it("reads a missing status as complete rather than nagging", () => {
    expect(grantState(undefined, true)).toBe("complete");
  });

  /** A connector with no per-scope opt-out has an empty services list. It must
   * not fall into "none" and claim nothing was granted. */
  it("does not read an empty service list as nothing granted", () => {
    const atlassian: ScopeStatus = {
      missing: [],
      complete: true,
      services: [],
    };
    expect(grantState(atlassian, true)).toBe("complete");
  });

  /** The badge is the actual defect this ticket names: a green "Connected" on
   * an account that granted nothing. Pinned so it cannot come back. */
  it("never labels a short grant Connected", () => {
    expect(GRANT_STATE_LABEL.none).not.toBe("Connected");
    expect(GRANT_STATE_LABEL.partial).not.toBe("Connected");
    expect(GRANT_STATE_VARIANT.none).not.toBe("success");
    expect(GRANT_STATE_VARIANT.partial).not.toBe("success");
    expect(GRANT_STATE_LABEL.complete).toBe("Connected");
  });
});

/**
 * SCRUM-147: the UI half of the SCRUM-145 default rule, same boundaries. A
 * suggestion appears ONLY when the default can serve nothing and a sibling
 * with a RECORDED full grant exists — a partial default may be a deliberate
 * choice, and an unreadable grant must never be advertised as full.
 */
describe("suggestBetterDefault", () => {
  let seq = 0;
  const account = (over: {
    isDefault?: boolean;
    granted?: string[];
    scopes?: string | null;
    connectedAt?: string;
  }) => ({
    id: `acct-${seq++}`,
    accountEmail: `acct-${seq}@example.com`,
    isDefault: over.isDefault ?? false,
    scopes: over.scopes === undefined ? "recorded" : over.scopes,
    connectedAt: over.connectedAt ?? "2026-08-01T00:00:00Z",
    scopeStatus: status(over.granted ?? []),
  });

  it("suggests the fully-granted sibling when the default grants nothing", () => {
    const broken = account({ isDefault: true, granted: [] });
    const full = account({ granted: ALL });
    expect(suggestBetterDefault([broken, full])?.id).toBe(full.id);
  });

  it("never suggests moving off a partial default — that may be a choice", () => {
    const narrow = account({ isDefault: true, granted: ["Gmail"] });
    const full = account({ granted: ALL });
    expect(suggestBetterDefault([narrow, full])).toBeNull();
  });

  it("suggests nothing when the broken default is the only account", () => {
    expect(suggestBetterDefault([account({ isDefault: true, granted: [] })])).toBeNull();
  });

  it("never advertises a sibling whose grant was not recorded", () => {
    const broken = account({ isDefault: true, granted: [] });
    // Fail-open reads null scopes as complete, but a suggestion is a positive
    // claim and needs positive knowledge — same rule as the server side.
    const unreadable = account({ granted: ALL, scopes: null });
    expect(suggestBetterDefault([broken, unreadable])).toBeNull();
  });

  it("leaves a default with no scope record alone", () => {
    const unreadableDefault = account({ isDefault: true, granted: ALL, scopes: null });
    const full = account({ granted: ALL });
    expect(suggestBetterDefault([unreadableDefault, full])).toBeNull();
  });

  it("prefers the most recently connected of two full siblings", () => {
    const broken = account({ isDefault: true, granted: [] });
    const older = account({ granted: ALL, connectedAt: "2026-01-01T00:00:00Z" });
    const newer = account({ granted: ALL, connectedAt: "2026-08-01T00:00:00Z" });
    expect(suggestBetterDefault([broken, older, newer])?.id).toBe(newer.id);
  });
});
