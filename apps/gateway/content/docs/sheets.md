---
title: "Sheets"
description: "Read, create, update, append and delete Google Sheets, find rows by value, and format a range into a readable table."
order: 5
section: "connectors"
connector: "google-workspace"
---

The Sheets connector lets your AI assistant read data from spreadsheets, write to cells, append rows, create new sheets, and manage the tabs inside them. Values written through the connector that begin with `=` are stored as text, never run as formulas.

![A sheets_update call rewriting two existing rows in place, with the updated range and cell count it returned](/docs/sheets-update.png)

## Available operations

| Tool | Description |
|------|-------------|
| `sheets_read` | Read data from a range of cells (e.g., `Sheet1!A1:D10`) |
| `sheets_create` | Create a new spreadsheet |
| `sheets_update` | Update specific cells in a sheet |
| `sheets_append` | Append rows to the end of a sheet |
| `sheets_delete` | Delete a spreadsheet |
| `sheets_add_tab` | Add a new tab to an existing spreadsheet, with an optional header row |
| `sheets_rename_tab` | Rename a tab by its current title; data is untouched, but saved ranges that name the old title stop resolving |
| `sheets_clear` | Clear values in a range while keeping the tab and its formatting; a bare tab name clears the whole tab |
| `sheets_delete_tab` | Delete a tab and every row in it; this cannot be undone via the API, so use `sheets_clear` when you only want to empty a tab |
| `sheets_find_rows` | Find the rows whose value in one column matches, and get back their row numbers plus a ready-made A1 range for each, so a lookup can be followed straight by an update. Searches many values in one call |
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
