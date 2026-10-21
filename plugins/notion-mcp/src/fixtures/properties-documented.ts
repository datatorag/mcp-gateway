/* Shape from Notion's API reference, not recorded. The recorded responses
 * (stage 0, 2026-10-21) hold title, rich_text, people, select, status, date
 * and rollup values only; those are tested from the recordings. Every other
 * property value below is written from the reference's page property value
 * object, one per type, with Notion's {id, type, <type>: value} envelope.
 * People's names, emails and file URLs are placeholders. */

export const DOCUMENTED = {
  number: { id: "a%3Bb", type: "number", number: 42.5 },
  number_empty: { id: "a%3Bb", type: "number", number: null },
  multi_select: {
    id: "flsb",
    type: "multi_select",
    multi_select: [
      { id: "f5a5adc2-3a94-4508-8105-df6afbcfb681", name: "TypeScript", color: "red" },
      { id: "67f6d24b-43d5-403a-8091-4a53e2d97cbf", name: "Docs", color: "blue" },
    ],
  },
  date_range: {
    id: "zfqj",
    type: "date",
    date: { start: "2026-10-20", end: "2026-10-24", time_zone: null },
  },
  date_zoned: {
    id: "zfqj",
    type: "date",
    date: { start: "2026-10-20T09:00:00.000-07:00", end: null, time_zone: "America/Los_Angeles" },
  },
  files: {
    id: "Q%7Dn%3E",
    type: "files",
    files: [
      {
        name: "plan.pdf",
        type: "file",
        file: { url: "https://example.com/avatar.png", expiry_time: "2026-10-21T04:40:00.000Z" },
      },
      { name: "spec", type: "external", external: { url: "https://example.com/avatar.png" } },
    ],
  },
  checkbox: { id: "ZI%40W", type: "checkbox", checkbox: true },
  url: { id: "bB%3D%5B", type: "url", url: "https://example.com/page" },
  email: { id: "y%5C%5E_", type: "email", email: "test-user@example.com" },
  phone_number: { id: "%5DKhQ", type: "phone_number", phone_number: "+1 555 0100" },
  formula_string: { id: "fy%3A%7B", type: "formula", formula: { type: "string", string: "Q4" } },
  formula_number: { id: "fy%3A%7B", type: "formula", formula: { type: "number", number: 3 } },
  formula_boolean: { id: "fy%3A%7B", type: "formula", formula: { type: "boolean", boolean: false } },
  formula_date: {
    id: "fy%3A%7B",
    type: "formula",
    formula: { type: "date", date: { start: "2026-11-01", end: null, time_zone: null } },
  },
  relation: {
    id: "mxp%5E",
    type: "relation",
    relation: [{ id: "90e22f57-b7e1-443a-852d-e22d38218d0c" }, { id: "82cb746e-af4d-4984-8f62-b3f50ed4c748" }],
    has_more: false,
  },
  relation_more: {
    id: "mxp%5E",
    type: "relation",
    relation: [{ id: "90e22f57-b7e1-443a-852d-e22d38218d0c" }],
    has_more: true,
  },
  rollup_number: {
    id: "%5E%7Cy%3C",
    type: "rollup",
    rollup: { type: "number", number: 1234, function: "sum" },
  },
  rollup_date: {
    id: "%5E%7Cy%3C",
    type: "rollup",
    rollup: { type: "date", date: { start: "2026-10-01", end: null, time_zone: null }, function: "latest_date" },
  },
  rollup_array: {
    id: "%5E%7Cy%3C",
    type: "rollup",
    rollup: {
      type: "array",
      array: [
        { type: "title", title: [{ type: "text", text: { content: "Alpha", link: null }, plain_text: "Alpha", href: null }] },
        { type: "number", number: 7 },
      ],
      function: "show_original",
    },
  },
  created_time: { id: "eB_%7D", type: "created_time", created_time: "2026-10-21T03:32:00.000Z" },
  created_by: {
    id: "%5BJCR",
    type: "created_by",
    created_by: { object: "user", id: "460f4399-740e-44ab-827d-0134421cdedf", name: "Test User", type: "person" },
  },
  created_by_partial: {
    id: "%5BJCR",
    type: "created_by",
    created_by: { object: "user", id: "460f4399-740e-44ab-827d-0134421cdedf" },
  },
  last_edited_time: { id: "KpQq", type: "last_edited_time", last_edited_time: "2026-10-21T03:37:00.000Z" },
  last_edited_by: {
    id: "KpQr",
    type: "last_edited_by",
    last_edited_by: { object: "user", id: "460f4399-740e-44ab-827d-0134421cdedf", name: "Test User", type: "person" },
  },
  unique_id: { id: "UId", type: "unique_id", unique_id: { prefix: "TASK", number: 12 } },
  unique_id_bare: { id: "UId", type: "unique_id", unique_id: { prefix: null, number: 12 } },
  verification: {
    id: "fpVq",
    type: "verification",
    verification: {
      state: "verified",
      verified_by: { object: "user", id: "460f4399-740e-44ab-827d-0134421cdedf" },
      date: { start: "2026-10-20T00:00:00.000Z", end: null, time_zone: null },
    },
  },
  button: { id: "btn1", type: "button", button: {} },
  place: {
    id: "plc1",
    type: "place",
    place: { lat: 37.7749, lon: -122.4194, name: "Office", address: "1 Example St", google_place_id: null },
  },
  unknown: { id: "zz1", type: "hologram", hologram: { shimmer: 3 } },
};
