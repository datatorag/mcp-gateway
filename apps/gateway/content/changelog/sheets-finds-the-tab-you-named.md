---
title: "Sheets queries find the tab you named, or say they can't"
date: "2026-10-03"
tags: ["sheets", "tools"]
connector: "google-workspace"
---

Asking Claude to query a tab that did not exist used to return rows anyway. They came from the first tab of the spreadsheet, with no error, so a typo in a tab name looked like a real answer. A tab with an apostrophe in its name, such as Bob's, did the same thing.

`sheets_query` now checks the range against the spreadsheet's actual tabs before it runs:

- A tab that does not exist is refused, and the refusal lists the tabs the spreadsheet has.
- A tab name on its own works even when it also reads as a cell, so a tab called Q3 or Log is the tab, not cell Q3 or column LOG.
- Tab names with apostrophes or exclamation marks resolve to the right tab. `sheets_find_rows` also reports the right row number on a tab with an exclamation mark in its name.

`sheets_format_table` and `sheets_format_range` resolve tabs the same way. If you ask `sheets_format_table` to trim the grid on a name that is both a tab and a cell reference, the call is refused with a note on how to say which one you meant.

One thing we measured and cannot change: when a column mixes numbers and text, Google's query endpoint reads it as whichever type most of its cells hold, and the others come back empty. The tool's description now says so. For a column like that, `sheets_read` or `sheets_find_rows` returns every cell.
