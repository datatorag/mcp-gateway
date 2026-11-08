---
title: "Scanned files into Docs, calendar changes since a time, and a straight answer on out-of-office"
date: "2026-11-07"
tags: ["drive", "calendar", "gmail", "gws-mcp"]
---

Three changes to the Google Workspace tools, each one a thing people were reaching for the raw
API to do.

- **`drive_copy_file` can convert while it copies.** `target_mime_type` names the Google type the
  copy becomes, so a PDF or an image copied as a Google Doc comes back with its text recognised,
  and `ocr_language` tells the recognition which language to expect. `convert` still works as the
  shortcut for Office files.
- **`calendar_list_events` reads a change feed.** `updated_min` returns the events changed since a
  time, `show_deleted` includes the ones removed, and `order_by` sorts by start time or by last
  update. Google refuses an `updated_min` too far back, and the tool says so.
- **Out-of-office is not something we change.** Setting the Gmail vacation responder needs a Google
  permission DataToRAG does not ask for, so no tool changes it. A raw API request to change it now
  says so directly instead of asking you to reconnect and grant it; reading the current responder
  still works.
