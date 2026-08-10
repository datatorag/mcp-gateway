---
title: "Sheets"
description: "Read, create, update, append, and delete Google Sheets."
order: 5
section: "connectors"
connector: "google-workspace"
---

The Sheets connector lets your AI assistant read data from spreadsheets, write to cells, append rows, create new sheets, and manage the tabs inside them. Values written through the connector that begin with `=` are stored as text, never run as formulas.

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

## Required scopes

- `https://www.googleapis.com/auth/spreadsheets`
- `https://www.googleapis.com/auth/drive` (for create/delete)

## Example prompts

- "Read the first 20 rows of my Sales Pipeline sheet and summarize the top deals"
- "Create a new spreadsheet called 'Expense Tracker' with columns for date, category, amount, and notes"
- "Append today's metrics to the bottom of the KPI tracking sheet"
- "Update cell B2 in the Budget sheet to 15000"
- "Add a new tab called 'Q3' to the KPI tracking sheet and rename the old 'Sheet1' tab to 'Archive'"
