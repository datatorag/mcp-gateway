---
title: "Read part of a long document, and clearer errors in Sheets and Docs"
date: "2026-08-31"
tags: ["docs", "sheets", "gws-mcp"]
connector: "google-workspace"
---

Three changes, all of them prompted by real calls that failed.

**`docs_get` can now read part of a document.** Pass `start_index` and `end_index` and you get
that slice back. They are the same character indices `mode: "index"` reports and
`docs_batch_update` consumes, so a read and the edit that follows it speak one coordinate
system rather than two.

A ranged response also tells you where you are: `totalEndIndex` for the document's full length,
`clipped` for whether there is more, and `nextStartIndex` to continue from. That matters more
than the range itself. Without it, a few thousand characters coming back looks identical whether
the document ended or the answer was cut off, and those two need opposite next steps. With no
range given, nothing changes and you get the whole document as before.

**`docs_batch_update` now shows what a request looks like.** The description carries worked
examples for the common shapes, `replaceAllText` among them, including the detail that
`matchCase` belongs inside `containsText` and not at the top level. That nesting is easy to get
wrong and the API only tells you afterwards.

**`sheets_find_rows` answers a bad tab name with the real ones.** Ask for a range naming a tab
that does not exist and instead of a raw parse error you get told there is no tab of that name,
followed by the tabs the spreadsheet actually has. One round trip instead of a guess. The
examples in the range parameter no longer name a tab that most spreadsheets do not have, which
is where some of those wrong guesses were coming from in the first place.
