---
title: "Sheets tab lifecycle"
date: "2026-08-07"
tags: ["sheets", "gws-mcp"]
connector: "google-workspace"
---

Tabs are now first-class. `sheets_add_tab` adds a tab to an existing
spreadsheet, with a title and an optional header row.
`sheets_rename_tab` renames a tab by its current title and leaves the
data untouched; saved ranges that name the old title stop resolving.
`sheets_clear` clears the values in a range while the tab and its
formatting stay; pass a bare tab name to clear the whole tab.
`sheets_delete_tab` deletes a tab and every row in it, and cannot be
undone through the API, so when "empty, but keep the tab" is what you
mean, `sheets_clear` is the non-destructive alternative.
