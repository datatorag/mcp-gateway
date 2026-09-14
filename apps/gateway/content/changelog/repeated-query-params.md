---
title: "gws_run takes repeated query parameters"
date: "2026-09-14"
tags: ["gws-mcp", "sheets", "gmail"]
connector: "google-workspace"
---

**Pass a list where the API takes one.** `gws_run` now accepts an array for any query parameter
the Google API repeats: `ranges` on a spreadsheet get, `labelIds` on a Gmail message list,
`metadataHeaders` on a message get. `{ "ranges": ["Sheet1!A1:B2", "Totals!A1:B5"] }` fetches both
blocks in one call. Until today the call was refused with "Array-valued parameters are not
supported" and the only way through was one call per value.
