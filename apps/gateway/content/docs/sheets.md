---
title: "Sheets"
description: "Read, create, update, append and delete Google Sheets, find rows by value, and format a range into a readable table."
order: 5
section: "connectors"
connector: "google-workspace"
faqs:
  - q: If I write a value starting with an equals sign, does it become a formula?
    a: >-
      Not unless that call asked for it. Values written through the DataToRAG
      Sheets connector are stored as text by default, so a product named =1+1
      stays the literal string, and evaluation is switched on per call with
      parse_formulas rather than per cell. Text you did not author yourself
      belongs in a call with parsing off, because a stranger's string evaluating
      in your sheet is exactly what that ordering prevents.
  - q: Why does my spreadsheet look unreadable even though the values are right?
    a: >-
      Column width. The Google Sheets API defaults to 100px columns, so anything
      longer than a few words is clipped and the reader never learns there was
      more text. The Sheets format-table tool applies the whole readable pass in
      one atomic call: header styling, a frozen header row, column widths,
      wrapping, optional banding, and an optional trim of the empty grid outside
      the range.
  - q: Does a successful formatting call mean the sheet looks the way I wanted?
    a: >-
      No. Formatting calls report what was sent, not what the sheet now looks
      like, and empty reply objects only tell you the batch was accepted. Opening
      the Google sheet is the only thing that tells you the result is what you
      meant.
  - q: What is the difference between clearing a tab and deleting one?
    a: >-
      Clearing keeps the tab. The DataToRAG clear tool empties values in a range
      while leaving the tab and its formatting in place, and a bare tab name
      clears the whole tab. Deleting a tab removes it and every row in it, and
      that cannot be undone through the Google Sheets API, so clear a tab when
      you only want to empty it.
  - q: Can it find rows by value and then update them?
    a: >-
      Yes. The Sheets find-rows tool returns the matching row numbers plus a
      ready-made A1 range for each, so a lookup can be followed straight by an
      update, and it searches many values in one call.
  - q: What if I need a spreadsheet operation the tools do not cover?
    a: >-
      There is a pass-through. Beneath the job-shaped Sheets tools sits the full
      Google Sheets batchUpdate pass-through, for what they do not cover: borders,
      merges, inserting or deleting columns, duplicating tabs and protected
      ranges.
---

The Sheets connector lets your AI assistant read data from spreadsheets, write to cells, append rows, create new sheets, and manage the tabs inside them. Values written through the connector are stored as text by default, so a value beginning with `=` stays literal unless that call sets `parse_formulas`, which turns evaluation on for the whole call rather than for one cell.

![A sheets_update call rewriting two existing rows in place, with the updated range and cell count it returned](/docs/sheets-update.png)

## Available operations

| Tool | Description |
|------|-------------|
| `sheets_read` | Read one range, or several ranges in one call (`ranges: [...]`), one block per range in order (e.g., `Sheet1!A1:D10`) |
| `sheets_create` | Create a new spreadsheet |
| `sheets_update` | Update specific cells in a sheet |
| `sheets_append` | Append rows to the end of a sheet |
| `sheets_delete` | Delete a spreadsheet |
| `sheets_add_tab` | Add a new tab to an existing spreadsheet, with an optional header row |
| `sheets_rename_tab` | Rename a tab by its current title; data is untouched, but saved ranges that name the old title stop resolving |
| `sheets_clear` | Clear values in a range while keeping the tab and its formatting; a bare tab name clears the whole tab |
| `sheets_delete_tab` | Delete a tab and every row in it; this cannot be undone via the API, so use `sheets_clear` when you only want to empty a tab |
| `sheets_find_rows` | Find the rows whose value in one column matches, and get back their row numbers plus a ready-made A1 range for each, so a lookup can be followed straight by an update. Searches many values in one call |
| `sheets_query` | Run a query in the QUERY() language over a range and get back only the matching rows: select, where, group by, order by, limit and the aggregates, in one call. Columns by sheet letter. Read-only |
| `sheets_format_table` | Apply the whole readable-table pass to a range in one atomic call: header styling, frozen header row, column widths, wrapping, optional banding, and an optional trim of the empty grid outside the range |
| `sheets_format_range` | Set fonts, colours, wrapping, alignment, padding, number formats and merges on named ranges. Takes a list of instructions and applies all of them in one atomic call |
| `sheets_batch_update` | The full Sheets `batchUpdate` pass-through, beneath the job-shaped tools above. Use it for what they do not cover: borders, merges, inserting or deleting columns, duplicating tabs, protected ranges |

## Making a sheet readable

A sheet can hold entirely correct values and still be unreadable: the API's
default column width is 100px, so anything longer than a few words is clipped.
`sheets_format_table` does the standard pass in one atomic call rather than one
call per property.

![A sheets_format_table call with its range, header_rows, freeze_header, column_widths, wrap and banded arguments, and the nine requests it sent](/docs/sheets-format-table.png)

Formatting calls report what was **sent**, not what the sheet now looks like.
Empty reply objects mean the batch was accepted; only opening the sheet tells
you the result is what you meant.

## Required scopes

- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive` (for create/delete)

## Example prompts

- "Read the first 20 rows of my Sales Pipeline sheet and summarize the top deals"
- "Create a new spreadsheet called 'Expense Tracker' with columns for date, category, amount, and notes"
- "Append today's metrics to the bottom of the KPI tracking sheet"
- "Update cell B2 in the Budget sheet to 15000"
- "Add a new tab called 'Q3' to the KPI tracking sheet and rename the old 'Sheet1' tab to 'Archive'"
