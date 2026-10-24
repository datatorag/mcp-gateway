---
title: "Upload a file from your computer into Drive, Jira or an email"
date: "2026-10-24"
tags: ["file-references", "drive", "jira", "gmail", "gws-mcp", "atlassian-mcp"]
---

A file on your own computer now has a way in that does not pass through the conversation. Ask
Claude for an upload link and it makes one with `file_upload_link`:

- **In a browser,** the link opens a page where you choose or drop the file and press Upload.
  It works on a phone too.
- **In a terminal,** the answer carries a one-line `curl -T` command that sends the file under
  its own name.

Either way you get back the file's size and SHA-256, and a short reference for Claude to use.
With it, Claude can put the file into Drive, attach it to a Jira issue, or attach it to an email,
beside any other attachments.

- One file per link, up to 25 MB. The link stops working ten minutes after it is made.
- The file is kept in memory for ten minutes after it arrives, for one use, and is never
  written to our disks.
- A link is yours: a call that carries it is refused, and the link is cancelled.

For a small file Claude already holds, such as an image you shared in the chat, it can still send
the file in the call itself, without a link.

How it all works, and what the receipts say, is in [Moving files between services](/docs/file-references).
