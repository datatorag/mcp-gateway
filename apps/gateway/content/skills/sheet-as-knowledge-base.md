---
title: "Keep a knowledge base in Google Sheets your agent can read"
order: 3
situation: "Our notes are scattered and half of them are stale. I want one place my agent can read and update."
produces: "A Google Sheet your agent reads and writes reliably, without the traps that make spreadsheets bad interfaces."
tools: [sheets_create, sheets_add_tab, sheets_read, sheets_update, sheets_append]
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
7. **URLs in their own plain-text column.** A `=HYPERLINK(url, label)` cell reads back as
   just the label. The address is not in the response at all, so a link that is perfectly
   usable to a person is unreachable to an agent.
8. **Status is a column, never formatting.** Strikethrough, colour and bold do not appear in
   the response, and nothing in this connector reads them. A row struck through to mean
   "done" is live data as far as an agent is concerned.

## What writing does to your values

Sheets parses what you write. Measured on a throwaway sheet, not assumed:

| You write | It stores | What happened |
|---|---|---|
| `007` | `7` | leading zeros stripped |
| `+15551234567` | `15551234567` | leading `+` stripped |
| `1.50` | `1.5` | trailing zero dropped |
| `=1+1` | `2` | a leading `=` is evaluated as a formula |

Two things to design around:

- **Ids that look like numbers get mangled.** Prefix them (`ACC-007`), or accept that `007`
  and `7` are the same record and you have just merged two.
- **Never write unchecked text into a cell.** A value beginning with `=` is a formula, not a
  string. Prefix with `'` if it has to survive verbatim.

`YYYY-MM-DD` dates and the word `TRUE` both round-trip unchanged, which is one more reason
the fixed vocabulary above picks that date format.

## Tabs

`sheets_add_tab` creates a tab and writes its header row in one call, so a new concern does
not need a new file.

Naming a tab that does not exist fails loudly rather than silently, and the error lists every
tab that does exist, so a typo tells you the real name on the way past. Read that error
instead of guessing again.

## When there is more than one tab

- **One tab owns a fact.** If `status` lives in two tabs they will disagree, and nothing in
  the response says which one is right. Everywhere else references the owning tab's `id`.
- **Two tables whose ids point at each other are a graph, and nothing joins it for you.**
  `sheets_read` takes one tab at a time, so a join is two reads and your own matching. Keep
  foreign keys as the literal `id` from the other tab, never a display name.
- **A rule nobody runs is decoration.** A `checked` column a human is supposed to tick is a
  wish. If a check matters, it belongs in the prompt that runs every time.

## The sheet is a cache

When a fact's real home is somewhere else (a billing system, a repo, a dashboard), the sheet
holds a copy that started going stale the moment it was written. Give those tables a
`checked_on` column, and treat an old date as *unknown* rather than as the value. A knowledge
base that cannot tell you how old it is gets trusted right up until the first time it is
wrong, and then not at all.

## A Lessons tab

Add a `Lessons` tab: `date`, `lesson`, `source_tab`. When a run turns up something the schema
does not capture (a column nobody populates, a status nobody uses, two rows that are the same
company), append it there instead of reporting it into a chat nobody rereads.

It is the one tab whose HISTORY is the point, and it earns the exception. Everything else
append-only belongs outside the sheet, but a lesson *about this sheet* stored anywhere else
will not be there the next time this sheet is opened.

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

**We measured that coercion table rather than reasoning about it, and reasoning would have
got it wrong in both directions.** Two cases we expected to break did not: `YYYY-MM-DD` dates
and the word `TRUE` both survived untouched. The leading-`+` case we had not thought of at
all. Ten minutes on a throwaway sheet is cheaper than one mangled id column.

**`=HYPERLINK` costs the most time of any trap here, because the sheet looks correct.** Every
link is clickable, every label is meaningful, and nothing about the page suggests a problem.
The agent sees a column of words with no addresses in it and has no way to report what is
missing, because from where it stands nothing is.

**Formatting is where the real state usually turns out to live.** Ask anyone what a
struck-through row in their sheet means and they will answer immediately. Nothing in the
response carries it, so that answer is not available to an agent, and unlike a missing column
there is no gap to notice. Every convention a team keeps in bold, colour or strikethrough has
to become a column before any of this works.

**One tab owns a fact is the rule that gets broken first**, because breaking it is always
locally convenient: copying `status` into the tab you are already looking at saves a read
today. The two copies diverge quietly, and the failure surfaces much later as an agent
confidently reporting a number that was true last month.

**A knowledge base is a habit, not a schema.** The rules above are what make a sheet
readable; the `Lessons` tab and the `checked_on` columns are what keep it worth reading. We
have seen more of these die from nobody maintaining them than from bad structure.
