---
title: "Sheets Claude writes now look like someone made them"
date: "2026-08-26"
tags: ["sheets", "formatting", "tools"]
connector: "google-workspace"
---

Writing values into a spreadsheet gives you no formatting at all. The default is columns 100
pixels wide with every long cell clipped to a slit, so a sheet with entirely correct data is
routinely unreadable, and the reader never learns there was more text.

Four tools fix that, and they are live now.

**`sheets_format_table`** does the whole readable pass in one call: column widths, wrapped and
top-aligned cells, a styled and frozen header row, hairline borders. This is the one to run on
any sheet a person is going to open.

**`sheets_format_range`** is for specific styling on top: fonts, colours, alignment, padding,
number formats, merges. It takes a list of instructions and applies them in one atomic call, so
a whole formatting pass is one call rather than one per range.

**`sheets_batch_update`** is the escape hatch beneath both, for anything they do not cover:
borders, banding, copy and paste, inserting or deleting columns, duplicating sheets.

**`sheets_find_rows`** is the one that saves the most work and is easiest to miss. It finds rows
by value and returns their **row numbers**, so you can update them directly instead of reading a
whole sheet and filtering it yourself. It searches many values in one call, so looking up twenty
customers is one call and not twenty, and values that matched nothing come back listed
separately, so an empty result cannot be mistaken for a broken one.

Nothing changes for existing calls. All four are additions.
