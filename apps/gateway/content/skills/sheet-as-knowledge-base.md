---
title: "Keep a knowledge base in Google Sheets your agent can read"
order: 3
situation: "Our notes are scattered and half of them are stale. I want one place my agent can read and update."
produces: "A Google Sheet your agent reads and writes reliably, without the traps that make spreadsheets bad interfaces."
tools: [sheets_create, sheets_read, sheets_update, sheets_append]
accounts: single
---

# A sheet your agent can actually read

Most "let the AI read our spreadsheet" setups break for reasons nobody sees, because a
spreadsheet is a human interface and an agent reading one is doing document archaeology.

This is a schema and a set of rules that make a Sheet behave like a data source. We run our
own company state this way.

```markdown
---
name: sheet-knowledge-base
description: Read and update a Google Sheet used as a shared knowledge base
---

# Sheet as knowledge base

## What goes in it

Put things whose CURRENT VALUE is the point: inventories, statuses, registries, anything you
would filter or sort.

Keep things whose HISTORY is the point somewhere else: decision logs, specs, anything
append-only. A spreadsheet makes history editable and unsearchable, which destroys the two
properties that made those documents worth keeping.

## Schema rules — these are what make it readable

1. **One header row, row 1. No merged cells anywhere.** Merged headers arrive at an agent as
   repeated text with no indication of which columns they spanned, so structure becomes
   guesswork.
2. **No spacer columns.** Empty columns used for visual separation come back as empty strings
   and shift every column index after them.
3. **Every table has an `id` column.** Never match rows on a display name — `AcmeCorp` and
   `Acme Corp` are different strings and the same company, and a failed match reads as "this
   record does not exist."
4. **One concern per tab, named explicitly.** `sheets_read` takes one tab at a time and echoes
   back the tab it resolved, so you always know what you actually read.
5. **Stable column order.** Adding a column at the end is safe. Reordering breaks every reader
   silently.
6. **Fixed vocabularies.** Dates as `YYYY-MM-DD`, status from a defined set, not free text.

## Reading it

`sheets_read` with an explicit A1 range. Check the response before computing on it:

- `range` tells you which tab actually resolved.
- `rowCount` and `columnCount` tell you the real extent of what came back. Ask for more than
  exists and you get back what exists — that is how you detect truncation instead of assuming
  you got everything.

Assert the extent before you trust the values. If you expected 40 rows and got 12, stop.

## Writing to it

- `sheets_append` to add rows. This is the safe default.
- `sheets_update` to change specific cells, with an explicit range.

Read before you write. Append blindly and you get duplicates; update blindly and you
overwrite something a human just changed.

## A first tab, to make this concrete

Start with a `Start here` tab that states what belongs in the sheet, what belongs elsewhere,
and the schema rules above. Future-you and everyone else you share it with will need it, and
a knowledge base whose own rules are undocumented drifts within a month.
```

## Notes from running this

**The "mutable state vs immutable record" split is the whole design.** Getting it wrong in
either direction hurts: put your decision log in a spreadsheet and you lose its history; keep
your inventory in prose and it is stale within a week.

**`rowCount` is the most underused field in the response.** It is the difference between
knowing you read everything and assuming it.

**Design the sheet for the reader, not the viewer.** Merged headers and spacer columns are
what make a sheet pleasant for a person and unreliable for an agent. If you want both, keep
the pretty version as a separate view.
