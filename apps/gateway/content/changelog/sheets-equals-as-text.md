---
title: "Sheets values starting with = are stored as text"
date: "2026-08-07"
tags: ["sheets", "gws-mcp"]
connector: "google-workspace"
---

When your assistant writes to a spreadsheet, a value beginning with
`=` is now stored as text, never run as a formula. A cell written as
`=SUM(A1:A10)` holds that string; nothing evaluates. Other values keep
Sheets' usual interpretation, so a numeric-looking string like `007`
is still stored as the number `7`.

If you want a live formula in a cell, enter it in the Sheets editor,
where it evaluates as always.
