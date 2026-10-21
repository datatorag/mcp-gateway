import { describe, expect, it } from "vitest";
import { DECODERS, decodeProperties, decodeProperty, pageTitle } from "./properties.js";
import { recorded } from "./fixtures/load.js";
import { DOCUMENTED as D } from "./fixtures/properties-documented.js";

/* One test per property type. Types present in the stage 0 recordings are
 * tested from them (row-page.json, query.json); the rest from
 * fixtures/properties-documented.ts, which is written from Notion's API
 * reference and says so. */

const row = recorded("row-page").body.properties;
const person = recorded("query").body.results[0].properties;

describe("recorded property values", () => {
  it("title", () => {
    expect(decodeProperty(row["Task name"])).toBe("Click me to learn how to hide checked items");
  });

  it("rich_text, empty", () => {
    expect(decodeProperty(person.About)).toBe("");
  });

  it("people, as names", () => {
    expect(decodeProperty(row.Assignee)).toEqual(["Test User"]);
  });

  it("select", () => {
    expect(decodeProperty(person["Membership Type"])).toBe("Workspace owner");
  });

  it("status", () => {
    expect(decodeProperty(row.Status)).toBe("Not started");
  });

  it("date with no end, as a string", () => {
    expect(decodeProperty(row["Due date"])).toBe("2026-10-20");
  });

  it("rollup of an empty array, unwrapped", () => {
    expect(decodeProperty(person.Email)).toEqual([]);
  });

  it("a whole row", () => {
    expect(decodeProperties(row)).toEqual({
      Assignee: ["Test User"],
      Status: "Not started",
      "Due date": "2026-10-20",
      "Task name": "Click me to learn how to hide checked items",
    });
    expect(pageTitle(row)).toBe("Click me to learn how to hide checked items");
  });
});

describe("documented property values (shape from Notion's API reference)", () => {
  it("number", () => {
    expect(decodeProperty(D.number)).toBe(42.5);
    expect(decodeProperty(D.number_empty)).toBeNull();
  });
  it("multi_select", () => expect(decodeProperty(D.multi_select)).toEqual(["TypeScript", "Docs"]));
  it("date with an end", () => expect(decodeProperty(D.date_range)).toEqual({ start: "2026-10-20", end: "2026-10-24" }));
  it("date with a time zone keeps it", () =>
    expect(decodeProperty(D.date_zoned)).toEqual({
      start: "2026-10-20T09:00:00.000-07:00",
      end: null,
      time_zone: "America/Los_Angeles",
    }));
  it("files, uploaded and external", () =>
    expect(decodeProperty(D.files)).toEqual([
      { name: "plan.pdf", url: "https://example.com/avatar.png" },
      { name: "spec", url: "https://example.com/avatar.png" },
    ]));
  it("checkbox", () => expect(decodeProperty(D.checkbox)).toBe(true));
  it("url", () => expect(decodeProperty(D.url)).toBe("https://example.com/page"));
  it("email", () => expect(decodeProperty(D.email)).toBe("test-user@example.com"));
  it("phone_number", () => expect(decodeProperty(D.phone_number)).toBe("+1 555 0100"));
  it("formula, each result type", () => {
    expect(decodeProperty(D.formula_string)).toBe("Q4");
    expect(decodeProperty(D.formula_number)).toBe(3);
    expect(decodeProperty(D.formula_boolean)).toBe(false);
    expect(decodeProperty(D.formula_date)).toBe("2026-11-01");
  });
  it("relation, as ids", () =>
    expect(decodeProperty(D.relation)).toEqual(["90e22f57-b7e1-443a-852d-e22d38218d0c", "82cb746e-af4d-4984-8f62-b3f50ed4c748"]));
  it("relation cut short says so, never passes as the whole relation", () =>
    expect(decodeProperty(D.relation_more)).toEqual({ ids: ["90e22f57-b7e1-443a-852d-e22d38218d0c"], has_more: true }));
  it("rollup, number, date and array unwrapped", () => {
    expect(decodeProperty(D.rollup_number)).toBe(1234);
    expect(decodeProperty(D.rollup_date)).toBe("2026-10-01");
    expect(decodeProperty(D.rollup_array)).toEqual(["Alpha", 7]);
  });
  it("created_time", () => expect(decodeProperty(D.created_time)).toBe("2026-10-21T03:32:00.000Z"));
  it("created_by, a name, or the id of a partial user", () => {
    expect(decodeProperty(D.created_by)).toBe("Test User");
    expect(decodeProperty(D.created_by_partial)).toBe("460f4399-740e-44ab-827d-0134421cdedf");
  });
  it("last_edited_time", () => expect(decodeProperty(D.last_edited_time)).toBe("2026-10-21T03:37:00.000Z"));
  it("last_edited_by", () => expect(decodeProperty(D.last_edited_by)).toBe("Test User"));
  it("unique_id, with and without a prefix", () => {
    expect(decodeProperty(D.unique_id)).toBe("TASK-12");
    expect(decodeProperty(D.unique_id_bare)).toBe(12);
  });
  it("verification, as its state", () => expect(decodeProperty(D.verification)).toBe("verified"));
  it("button holds no value", () => expect(decodeProperty(D.button)).toBeNull());
  it("place", () =>
    expect(decodeProperty(D.place)).toEqual({ name: "Office", address: "1 Example St", lat: 37.7749, lon: -122.4194 }));
  it("an unknown type passes through by its type name and is never thrown on", () => {
    expect(decodeProperty(D.unknown)).toEqual({ shimmer: 3 });
    expect(decodeProperty({ type: "nothing_here" })).toBeNull();
    expect(decodeProperty(null)).toBeNull();
  });
});

describe("coverage", () => {
  it("every supported type has its own decoder, and no other key is there", () => {
    const named = [
      "title", "rich_text", "number", "select", "multi_select", "status", "date", "people", "files",
      "checkbox", "url", "email", "phone_number", "formula", "relation", "rollup", "created_time",
      "created_by", "last_edited_time", "last_edited_by", "unique_id", "verification", "button", "place",
    ];
    expect(Object.keys(DECODERS).sort()).toEqual([...named].sort());
  });
});
