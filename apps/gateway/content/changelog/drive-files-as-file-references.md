---
title: "Download a Drive file, or a Doc as a PDF, without it entering the chat"
date: "2026-10-19"
tags: ["drive", "file-references", "gws-mcp"]
connector: "google-workspace"
---

A Google Drive file can now be named by a file reference, the same way an email or one of its
attachments already could, so the tools that take a file take a Drive file too.

There are two new references. `drive_file` names a file as it is stored in Drive: a PDF, an
image, a spreadsheet someone uploaded. `drive_export` names a Google Docs, Sheets or Slides file
together with a format, such as `pdf`, `docx`, `xlsx` or `pptx`, and the file is exported to it.

With `file_download_link`, a Drive file or a Doc as a PDF goes to your computer through a link
that works once, with the SHA-256 of what was sent. With `jira_add_attachment` it goes onto a
Jira issue. With `drive_upload_file` and a reference naming another of your connected Google
accounts, it is copied from one account's Drive into another's. In every case the file's
content is not returned and does not enter the conversation.

A folder, a shortcut, a file in Trash, and a Google file asked for as a stored one are refused
before anything is read. [Moving files between services](/docs/file-references) lists the
formats each kind of Google file exports to.
