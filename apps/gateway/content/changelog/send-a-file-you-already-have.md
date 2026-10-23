---
title: "Put a file Claude already has into Drive or onto a Jira issue"
date: "2026-10-23"
tags: ["file-references", "drive", "jira", "gws-mcp", "atlassian-mcp"]
---

Until now, the tools that take a file only took a reference to a file already in one of your
connected services: an email, an attachment, a Drive file. A screenshot or a PDF you had just
shared in the chat had no way in.

Now it does. When Claude already holds the file, it can send it with the call as a `content`
reference, and DataToRAG puts it into Drive with `drive_upload_file` or onto a Jira issue with
`jira_add_attachment`, in one step.

- The file can be up to 1 MB.
- The receipt gives the byte count and SHA-256 of what DataToRAG received and handed on. For
  Drive it also says whether what Drive stored matches.
- The file is held in memory only while it moves, and is never written to our disks.

How to send one, and what the receipt says, is in [Moving files between services](/docs/file-references).
