---
title: "Nine tools for what people were reaching the raw API call for"
date: "2026-10-12"
tags: ["gmail", "drive", "sheets", "calendar", "gws-mcp"]
connector: "google-workspace"
---

The Google Workspace connector has one generic tool, `gws_run`, that sends a single request to
a Google API method by name. It is there for the calls nothing else covers. A call made that
way needs the caller to know Google's resource paths and parameters, and it fails in ways that
say little: a list of ranges handed to a method that takes one, a drafts listing refused for a
`userId` nobody mentioned, an attachment fetched whole and then rejected for its size.

Nine of those calls are now tools of their own.

**Gmail.** `gmail_trash` moves a message to Trash and `gmail_untrash` takes it back out.
`gmail_list_drafts` lists the mailbox's drafts with the IDs the other draft tools take.
`gmail_get_attachment` describes one attachment by its part ID, with its name, type and size,
and returns the content as text when it is a text file of up to 0.5 MB. Anything else, or
anything larger, comes back as a description that states the size, with no content. File bytes
are never returned as base64. To get a file somewhere you can open it,
`gmail_save_attachment_to_drive` still puts it in Drive.

**Drive.** `drive_get_file` describes a file or folder without reading it: name, type, size,
the folders it is in, owners, dates and link. `drive_move_file` moves it into another folder
and takes it out of the one it was in. `drive_trash_file` moves it to Trash.

**Sheets.** `sheets_get_metadata` returns a spreadsheet's tabs with their titles, sheet IDs,
grid sizes and frozen rows, and no cell data at any size. `sheets_copy_tab_to` copies a tab, by
title, into another spreadsheet.

**Calendar.** `calendar_list_events` has always returned a `nextPageToken` when there were
more events than it was asked for. It now takes that token back as `page_token`, so the next
page can be read.

Reading several ranges in one `sheets_read` call, with `ranges`, was already there.

`gws_run` itself does the same thing it did. Its description now says what it is: a custom
query tool for the Gmail, Calendar, Drive, Sheets, Docs, Slides, People and Tasks APIs, with a
link to Google's reference. In the Agent, the moving and trashing tools ask for approval
before they run, like every other write.
