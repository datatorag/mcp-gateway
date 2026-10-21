import { describe, expect, it } from "vitest";
import {
  ARRAY_MAX,
  ENCODERS,
  InputError,
  RICH_TEXT_MAX,
  copyableValue,
  encodeProperties,
  encodeSchemaMap,
  encodeSchemaUpdates,
  richText,
} from "./encode.js";
import { DECODERS } from "./properties.js";
import { recorded } from "./fixtures/load.js";

/* Plain values in, Notion's typed envelopes out, checked against the data
 * source schema before anything is sent. Every refusal here is ours, in
 * words, so Notion never sees a request it would answer with a 400. */

/** A schema with one property of every writable type, plus read-only ones.
 * Shape from Notion's data source object (the reference), not recorded. */
const SCHEMA = {
  Name: { id: "title", type: "title", title: {} },
  Notes: { id: "n", type: "rich_text", rich_text: {} },
  Estimate: { id: "e", type: "number", number: { format: "number" } },
  Priority: {
    id: "p",
    type: "select",
    select: { options: [{ id: "1", name: "High" }, { id: "2", name: "Low" }] },
  },
  Tags: {
    id: "t",
    type: "multi_select",
    multi_select: { options: [{ id: "a", name: "Docs" }, { id: "b", name: "Bug" }] },
  },
  Stage: {
    id: "s",
    type: "status",
    status: { options: [{ id: "x", name: "Not started" }, { id: "y", name: "Done" }] },
  },
  Due: { id: "d", type: "date", date: {} },
  Owner: { id: "o", type: "people", people: {} },
  Attachments: { id: "f", type: "files", files: {} },
  Shipped: { id: "c", type: "checkbox", checkbox: {} },
  Link: { id: "u", type: "url", url: {} },
  Mail: { id: "m", type: "email", email: {} },
  Phone: { id: "ph", type: "phone_number", phone_number: {} },
  Related: { id: "r", type: "relation", relation: { data_source_id: "abc" } },
  Where: { id: "w", type: "place", place: {} },
  Checked: { id: "v", type: "verification", verification: {} },
  Score: { id: "sc", type: "formula", formula: { expression: "1" } },
  Created: { id: "ct", type: "created_time", created_time: {} },
  Ticket: { id: "id", type: "unique_id", unique_id: { prefix: "T" } },
  Mystery: { id: "my", type: "something_new", something_new: {} },
};

const USER = "460f4399-740e-44ab-827d-0134421cdedf";
const ROW = "eec14aaa-f8cb-4ef3-82ff-68f50ca52380";

function refusal(fn: () => unknown): string {
  try {
    fn();
  } catch (err) {
    expect(err).toBeInstanceOf(InputError);
    return (err as Error).message;
  }
  throw new Error("expected a refusal");
}

describe("rich text chunking", () => {
  it("2,000 characters is one piece, 2,001 is two", () => {
    const at = richText("a".repeat(RICH_TEXT_MAX), "Notes");
    expect(at).toHaveLength(1);
    expect(at[0]).toEqual({ type: "text", text: { content: "a".repeat(2000) } });

    const over = richText("a".repeat(RICH_TEXT_MAX + 1), "Notes");
    expect(over).toHaveLength(2);
    expect(over.map((p) => (p.text as { content: string }).content.length)).toEqual([2000, 1]);
  });

  it("joins back to the text it was given", () => {
    const text = "x".repeat(4500) + "end";
    expect(richText(text, "Notes").map((p) => (p.text as { content: string }).content).join("")).toBe(text);
  });

  it("does not split a character that takes two code units", () => {
    const text = "a".repeat(RICH_TEXT_MAX - 1) + "😀" + "b";
    const pieces = richText(text, "Notes").map((p) => (p.text as { content: string }).content);
    expect(pieces[0]).toBe("a".repeat(RICH_TEXT_MAX - 1));
    expect(pieces[1]).toBe("😀b");
  });

  it("100 pieces is accepted and 101 refused in words", () => {
    expect(richText("a".repeat(RICH_TEXT_MAX * ARRAY_MAX), "Notes")).toHaveLength(100);
    const msg = refusal(() => richText("a".repeat(RICH_TEXT_MAX * ARRAY_MAX + 1), "Notes"));
    expect(msg).toMatch(/Notes is 200001 characters/);
    expect(msg).toMatch(/200000/);
  });

  it("an empty string is an empty list, which clears the text", () => {
    expect(richText("", "Notes")).toEqual([]);
  });
});

describe("one encoder per writable property type", () => {
  const enc = (values: Record<string, unknown>) => encodeProperties(values, SCHEMA);

  it("has an encoder for every type the decoders read that Notion lets a page write set", () => {
    const readOnly = ["formula", "rollup", "created_time", "created_by", "last_edited_time", "last_edited_by", "unique_id", "button"];
    for (const type of Object.keys(DECODERS)) {
      if (readOnly.includes(type)) continue;
      expect(ENCODERS[type], type).toBeTypeOf("function");
    }
  });

  it("title and rich_text: a string to text pieces, null to empty", () => {
    expect(enc({ Name: "Plan", Notes: null })).toEqual({
      Name: { title: [{ type: "text", text: { content: "Plan" } }] },
      Notes: { rich_text: [] },
    });
    expect(refusal(() => enc({ Notes: 5 }))).toMatch(/Notes is a rich_text property and takes a string/);
  });

  it("number: a number or null", () => {
    expect(enc({ Estimate: 3.5 })).toEqual({ Estimate: { number: 3.5 } });
    expect(enc({ Estimate: null })).toEqual({ Estimate: { number: null } });
    expect(refusal(() => enc({ Estimate: "3" }))).toMatch(/Estimate is a number property and takes a number/);
  });

  it("select: an existing option's name, or null", () => {
    expect(enc({ Priority: "High" })).toEqual({ Priority: { select: { name: "High" } } });
    expect(enc({ Priority: null })).toEqual({ Priority: { select: null } });
    const msg = refusal(() => enc({ Priority: "Urgent" }));
    expect(msg).toMatch(/"Urgent" is not an option of Priority/);
    expect(msg).toMatch(/High, Low/);
    expect(msg).toMatch(/notion_update_data_source/);
    expect(refusal(() => enc({ Priority: "high" }))).toMatch(/"High"/);
    expect(refusal(() => enc({ Priority: ["High"] }))).toMatch(/takes one option name/);
  });

  it("multi_select: a list of existing option names, at most 100", () => {
    expect(enc({ Tags: ["Docs", "Bug"] })).toEqual({ Tags: { multi_select: [{ name: "Docs" }, { name: "Bug" }] } });
    expect(enc({ Tags: [] })).toEqual({ Tags: { multi_select: [] } });
    expect(refusal(() => enc({ Tags: ["Docs", "Nope"] }))).toMatch(/"Nope" is not an option of Tags/);
    expect(refusal(() => enc({ Tags: "Docs" }))).toMatch(/Tags is a multi_select property and takes a list/);
  });

  it("status: an existing option's name, or null", () => {
    expect(enc({ Stage: "Done" })).toEqual({ Stage: { status: { name: "Done" } } });
    expect(refusal(() => enc({ Stage: "Shipped" }))).toMatch(/"Shipped" is not an option of Stage.*Not started, Done/);
  });

  it("date: a date string, an object with start, or null", () => {
    expect(enc({ Due: "2026-10-20" })).toEqual({ Due: { date: { start: "2026-10-20" } } });
    expect(enc({ Due: { start: "2026-10-20T09:00:00", end: "2026-10-21", time_zone: "America/Los_Angeles" } })).toEqual({
      Due: { date: { start: "2026-10-20T09:00:00", end: "2026-10-21", time_zone: "America/Los_Angeles" } },
    });
    expect(enc({ Due: null })).toEqual({ Due: { date: null } });
    expect(refusal(() => enc({ Due: "next tuesday" }))).toMatch(/Due is a date property/);
    expect(refusal(() => enc({ Due: { end: "2026-10-20" } }))).toMatch(/Due is a date property/);
  });

  it("people: a list of user ids", () => {
    expect(enc({ Owner: [USER.replace(/-/g, "")] })).toEqual({ Owner: { people: [{ object: "user", id: USER }] } });
    expect(refusal(() => enc({ Owner: ["Test User"] }))).toMatch(/Owner is a people property and takes a list of Notion user ids/);
  });

  it("files: external links, with a name taken from the link when absent", () => {
    expect(enc({ Attachments: ["https://example.com/a/plan.pdf", { url: "https://example.com/x", name: "Spec" }] })).toEqual({
      Attachments: {
        files: [
          { type: "external", name: "plan.pdf", external: { url: "https://example.com/a/plan.pdf" } },
          { type: "external", name: "Spec", external: { url: "https://example.com/x" } },
        ],
      },
    });
    expect(refusal(() => enc({ Attachments: [42] }))).toMatch(/Attachments is a files property/);
  });

  it("checkbox: true or false", () => {
    expect(enc({ Shipped: false })).toEqual({ Shipped: { checkbox: false } });
    expect(refusal(() => enc({ Shipped: "yes" }))).toMatch(/Shipped is a checkbox property and takes true or false/);
  });

  it("url, email, phone_number: a string or null, within Notion's lengths", () => {
    expect(enc({ Link: "https://example.com", Mail: "a@example.com", Phone: null })).toEqual({
      Link: { url: "https://example.com" },
      Mail: { email: "a@example.com" },
      Phone: { phone_number: null },
    });
    expect(refusal(() => enc({ Mail: "a".repeat(101) }))).toMatch(/Mail .* at most 100 characters/);
    expect(refusal(() => enc({ Link: 7 }))).toMatch(/Link is a url property/);
  });

  it("relation: a list of page ids, at most 100", () => {
    expect(enc({ Related: [ROW] })).toEqual({ Related: { relation: [{ id: ROW }] } });
    const many = Array.from({ length: ARRAY_MAX }, () => ROW);
    expect((enc({ Related: many }).Related as { relation: unknown[] }).relation).toHaveLength(100);
    expect(refusal(() => enc({ Related: [...many, ROW] }))).toMatch(/Related takes at most 100 items; it was given 101/);
  });

  it("the 100 cap holds for every list type", () => {
    const tags = Array.from({ length: 101 }, () => "Docs");
    expect(refusal(() => enc({ Tags: tags }))).toMatch(/Tags takes at most 100 items; it was given 101/);
    const people = Array.from({ length: 101 }, () => USER);
    expect(refusal(() => enc({ Owner: people }))).toMatch(/at most 100/);
    const files = Array.from({ length: 101 }, () => "https://example.com/f");
    expect(refusal(() => enc({ Attachments: files }))).toMatch(/at most 100/);
  });

  it("place and verification", () => {
    expect(enc({ Where: { lat: 1.5, lon: 2, name: "Office" }, Checked: "verified" })).toEqual({
      Where: { place: { lat: 1.5, lon: 2, name: "Office" } },
      Checked: { verification: { state: "verified" } },
    });
    expect(refusal(() => enc({ Where: { name: "Office" } }))).toMatch(/Where is a place property/);
    expect(refusal(() => enc({ Checked: "maybe" }))).toMatch(/Checked is a verification property/);
  });

  it("a property Notion sets is refused, naming why", () => {
    expect(refusal(() => enc({ Score: 1 }))).toMatch(/Score is a formula property, which Notion sets/);
    expect(refusal(() => enc({ Created: "2026-10-20" }))).toMatch(/Created is a created_time property, which Notion sets/);
    expect(refusal(() => enc({ Ticket: 4 }))).toMatch(/Ticket is a unique_id property/);
  });

  it("a type this plugin does not know is refused by name, not sent", () => {
    expect(refusal(() => enc({ Mystery: "x" }))).toMatch(/Mystery is a something_new property, which this tool does not write/);
  });

  it("an unknown property name is refused with the names the data source has", () => {
    const msg = refusal(() => enc({ Statuss: "Done" }));
    expect(msg).toMatch(/This data source has no property named "Statuss"/);
    expect(msg).toMatch(/Name, Notes, Estimate/);
  });

  it("every problem in one call is reported together", () => {
    const msg = refusal(() => enc({ Estimate: "x", Priority: "Nope", Ghost: 1 }));
    expect(msg).toMatch(/Estimate/);
    expect(msg).toMatch(/Nope/);
    expect(msg).toMatch(/Ghost/);
  });

  it("properties must be an object", () => {
    expect(refusal(() => encodeProperties(["Name"], SCHEMA))).toMatch(/properties takes an object/);
  });

  it("works against the recorded data source schema", () => {
    const schema = recorded("data-source").body.properties;
    const out = encodeProperties({ Name: "Row", "Membership Type": "Workspace owner" }, schema);
    expect(out).toEqual({
      Name: { title: [{ type: "text", text: { content: "Row" } }] },
      "Membership Type": { select: { name: "Workspace owner" } },
    });
  });
});

describe("schema maps for a new database", () => {
  it("a type name alone, or an object with options and settings", () => {
    expect(
      encodeSchemaMap({
        Name: "title",
        Due: "date",
        Priority: { type: "select", options: ["High", { name: "Low", color: "gray" }] },
        Stage: { type: "status", options: [{ name: "Doing", group: "In progress" }] },
        Cost: { type: "number", format: "dollar", description: "In dollars" },
        Parent: { type: "relation", data_source_id: "fcfeab1774c94fac80268fdff653c6c5" },
        Total: { type: "formula", expression: "prop(\"Cost\") * 2" },
        Ticket: { type: "unique_id", prefix: "T" },
        Raw: { type: "rollup", config: { function: "count", relation_property_name: "Parent", rollup_property_name: "Name" } },
      })
    ).toEqual({
      Name: { title: {} },
      Due: { date: {} },
      Priority: { select: { options: [{ name: "High" }, { name: "Low", color: "gray" }] } },
      Stage: { status: { options: [{ name: "Doing", group: "In progress" }] } },
      Cost: { number: { format: "dollar" }, description: "In dollars" },
      Parent: {
        relation: { data_source_id: "fcfeab17-74c9-4fac-8026-8fdff653c6c5", type: "single_property", single_property: {} },
      },
      Total: { formula: { expression: "prop(\"Cost\") * 2" } },
      Ticket: { unique_id: { prefix: "T" } },
      Raw: { rollup: { function: "count", relation_property_name: "Parent", rollup_property_name: "Name" } },
    });
  });

  it("refuses an unknown type, a missing setting, two titles and over 100 options", () => {
    expect(refusal(() => encodeSchemaMap({ A: "colour" }))).toMatch(/A: "colour" is not a Notion property type/);
    expect(refusal(() => encodeSchemaMap({ T: { type: "formula" } }))).toMatch(/T: a formula property takes an expression/);
    expect(refusal(() => encodeSchemaMap({ R: { type: "relation" } }))).toMatch(/R: a relation property takes a data_source_id/);
    expect(refusal(() => encodeSchemaMap({ A: "title", B: "title" }))).toMatch(/one title property; this map has 2/);
    const options = Array.from({ length: 101 }, (_, i) => `o${i}`);
    expect(refusal(() => encodeSchemaMap({ S: { type: "select", options } }))).toMatch(/S takes at most 100 items; it was given 101/);
    expect(refusal(() => encodeSchemaMap({ S: { type: "select", options: [1] } }))).toMatch(/S: each option is a name/);
  });
});

describe("schema updates for an existing data source", () => {
  it("null removes, name renames, a type changes the type, and they combine", () => {
    expect(
      encodeSchemaUpdates({
        Old: null,
        Estimate: { name: "Hours" },
        Notes: "number",
        Kind: { name: "Category", type: "select", options: ["A"] },
      })
    ).toEqual({
      Old: null,
      Estimate: { name: "Hours" },
      Notes: { number: {} },
      Kind: { name: "Category", select: { options: [{ name: "A" }] } },
    });
  });

  it("refuses an entry that changes nothing", () => {
    expect(refusal(() => encodeSchemaUpdates({ A: {} }))).toMatch(/A: an update names a new name, a type, or null to remove/);
  });
});

describe("copyable values (duplicate)", () => {
  it("turns a read property into the plain value the encoder takes", () => {
    const row = recorded("row-page").body.properties as Record<string, { type: string }>;
    for (const [name, prop] of Object.entries(row)) {
      const copied = copyableValue(prop);
      if (["title", "rich_text", "select", "status", "date"].includes(prop.type)) {
        expect(copied, name).toBeDefined();
      }
    }
    expect(copyableValue({ type: "people", people: [{ object: "user", id: USER, name: "x" }] })).toEqual({ value: [USER] });
    expect(copyableValue({ type: "relation", relation: [{ id: ROW }] })).toEqual({ value: [ROW] });
    expect(copyableValue({ type: "formula", formula: { type: "number", number: 1 } })).toBeUndefined();
    expect(
      copyableValue({
        type: "files",
        files: [
          { name: "a", type: "file", file: { url: "https://example.com/hosted" } },
          { name: "b", type: "external", external: { url: "https://example.com/b" } },
        ],
      })
    ).toEqual({ value: [{ name: "b", url: "https://example.com/b" }], dropped: "1 file stored in Notion" });
  });
});
