/**
 * SCRUM-110 and SCRUM-321: one generator for the agent's empty states.
 *
 * Suggestions come from what the user can do (capability), then content
 * fills the one slot that may name a file. Each rule from the spec is one
 * assertion here, so a failure says which rule broke.
 */

import { describe, expect, it } from "vitest";
import {
  SHAPES,
  hasRealCorrespondence,
  suggestionsFor,
  withFileSuggestion,
  type Capability,
} from "./suggestion-generator";

const ALL_GOOGLE = ["gmail", "drive", "calendar", "docs", "sheets", "slides", "contacts", "tasks"];

function cap(over: Partial<Capability> = {}): Capability {
  return {
    services: new Set(["google-workspace"]),
    googleServices: new Set(ALL_GOOGLE),
    accountsPer: new Map([["google-workspace", 1]]),
    hasCorrespondence: null,
    ...over,
  };
}

const shapeOf = (id: string) => SHAPES.find((s) => s.id === id)!;

describe("suggestionsFor", () => {
  it("offers nothing when nothing is connected: the connect control leads", () => {
    expect(
      suggestionsFor(cap({ services: new Set(), googleServices: new Set(), accountsPer: new Map() }), {
        context: "first_run",
      })
    ).toEqual([]);
  });

  it("only offers what the connected services can serve", () => {
    const calendarOnly = suggestionsFor(cap({ googleServices: new Set(["calendar"]) }), {
      context: "first_run",
    });
    expect(calendarOnly.length).toBeGreaterThan(0);
    for (const s of calendarOnly) {
      expect(shapeOf(s.id).needs.google ?? []).not.toContain("gmail");
      for (const g of shapeOf(s.id).needs.google ?? []) expect(g).toBe("calendar");
    }
    const atlassianOnly = suggestionsFor(
      cap({
        services: new Set(["atlassian"]),
        googleServices: new Set(),
        accountsPer: new Map([["atlassian", 1]]),
      }),
      { context: "first_run" }
    );
    for (const s of atlassianOnly) expect(shapeOf(s.id).needs.services).toEqual(["atlassian"]);
  });

  it("puts fresh-account shapes first on a first run", () => {
    const first = suggestionsFor(cap({ hasCorrespondence: true }), { context: "first_run" });
    expect(first.map((s) => shapeOf(s.id).freshAccount)).toEqual(
      [...first.map((s) => shapeOf(s.id).freshAccount)].sort((a, b) => Number(b) - Number(a))
    );
    expect(shapeOf(first[0].id).freshAccount).toBe(true);
  });

  it("offers the inbox summary only once real correspondence is known", () => {
    const ids = (c: boolean | null) =>
      suggestionsFor(cap({ hasCorrespondence: c }), { context: "dashboard" }).map((s) => s.id);
    expect(ids(null)).not.toContain("mail_to_status_doc");
    expect(ids(false)).not.toContain("mail_to_status_doc");
    expect(ids(true)).toContain("mail_to_status_doc");
  });

  it("leads with a chain or a write, never a read, when one is eligible", () => {
    const s = suggestionsFor(cap({ hasCorrespondence: true }), { context: "dashboard" });
    expect(["chain", "write"]).toContain(shapeOf(s[0].id).kind);
  });

  it("offers the multi-account shape only with more than one Google account", () => {
    const ids = (n: number) =>
      SHAPES.filter((shape) => shape.kind === "multi_account").map((shape) => shape.id).filter((id) =>
        suggestionsFor(cap({ accountsPer: new Map([["google-workspace", n]]), hasCorrespondence: true }), {
          context: "dashboard",
          limit: SHAPES.length,
        })
          .map((s) => s.id)
          .includes(id)
      );
    expect(ids(1)).toEqual([]);
    expect(ids(2).length).toBeGreaterThan(0);
  });

  it("never shows two of the same kind in the first three", () => {
    for (const context of ["first_run", "dashboard"] as const) {
      const kinds = suggestionsFor(cap({ hasCorrespondence: true }), { context }).map(
        (s) => shapeOf(s.id).kind
      );
      expect(new Set(kinds).size).toBe(kinds.length);
    }
  });

  it("degrades honestly: one service shows that service's shapes and does not pad", () => {
    const notion = suggestionsFor(
      cap({
        services: new Set(["notion"]),
        googleServices: new Set(),
        accountsPer: new Map([["notion", 1]]),
      }),
      { context: "first_run" }
    );
    expect(notion.length).toBeGreaterThan(0);
    expect(notion.length).toBeLessThanOrEqual(SHAPES.filter((s) => s.needs.services.includes("notion")).length);
    for (const s of notion) expect(shapeOf(s.id).needs.services).toEqual(["notion"]);
  });

  it("after a connect, leads with the service just connected", () => {
    const both = cap({
      services: new Set(["google-workspace", "atlassian"]),
      accountsPer: new Map([
        ["google-workspace", 1],
        ["atlassian", 1],
      ]),
    });
    const s = suggestionsFor(both, { context: "post_connect", service: "atlassian" });
    expect(shapeOf(s[0].id).needs.services).toContain("atlassian");
  });

  it("returns at most three, and the visible text never names a file", () => {
    const s = suggestionsFor(cap({ hasCorrespondence: true }), { context: "dashboard" });
    expect(s.length).toBeLessThanOrEqual(3);
    for (const x of s) expect(x.text).not.toMatch(/"/);
  });
});

describe("withFileSuggestion", () => {
  const base = suggestionsFor(cap({ hasCorrespondence: true }), { context: "dashboard" });

  it("puts one file suggestion in the lowest slot, truncated to 40 characters", () => {
    const name = "A very long quarterly planning document title that keeps going";
    const out = withFileSuggestion(base, name);
    expect(out).toHaveLength(3);
    expect(out[2].id).toBe("drive_file_summary");
    expect(out[2].text).toContain(`"${name.slice(0, 39)}…"`);
    expect(out.slice(0, 2).every((s) => !s.text.includes('"'))).toBe(true);
  });

  it("adds nothing without a file name", () => {
    expect(withFileSuggestion(base, null)).toEqual(base);
  });
});

describe("hasRealCorrespondence", () => {
  const list = (...froms: string[]) => JSON.stringify(froms.map((from, i) => ({ id: String(i), from })));

  it("is true when a message comes from a person", () => {
    expect(hasRealCorrespondence(list("no-reply@accounts.example.com", "Sam Lee <sam@example.com>"))).toBe(true);
  });

  it("is false when every message is a notification, and for anything unreadable", () => {
    expect(
      hasRealCorrespondence(
        list("no-reply@accounts.example.com", "Example <notifications@example.com>", "alerts@bank.example")
      )
    ).toBe(false);
    expect(hasRealCorrespondence('"No messages found."')).toBe(false);
    expect(hasRealCorrespondence("not json")).toBe(false);
  });
});
