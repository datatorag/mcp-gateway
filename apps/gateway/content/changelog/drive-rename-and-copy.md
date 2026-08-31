---
title: "Rename and copy files in Drive"
date: "2026-08-30"
tags: ["drive", "gws-mcp"]
connector: "google-workspace"
---

Drive could search, read and create folders. It could not rename anything, and it could not
copy anything. Two tools close that.

**`drive_rename_file`** renames a file or folder. The name changes and nothing else does:
content, location and sharing are untouched. It works on any Drive item the account can edit,
Docs and Sheets and Slides and folders alike.

**`drive_copy_file`** copies a file and names the copy in the same call, optionally placing it
in a different folder with `parent_id`.

The copy is the more useful of the two, and the reason is templates. Ask Claude to rebuild a
template and you get something that looks close and drifts a little every time. Ask it to copy
one and you get the original's tabs, formatting and formulas exactly, because it is the same
file. Copy first, then fill in the copy.

One limit worth stating plainly: **folders cannot be copied.** Drive answers a folder copy with
a 403 saying the file cannot be copied by the user, which reads like a permissions problem you
should retry. It is not. It is how the API works, and no amount of access changes it.
