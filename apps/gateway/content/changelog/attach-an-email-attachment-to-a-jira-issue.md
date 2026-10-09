---
title: "Attach an email's attachment to a Jira issue"
date: "2026-10-07"
tags: ["jira", "gmail", "tools"]
connector: "atlassian"
---

`jira_add_attachment` now takes a second kind of file reference: one attachment of a Gmail message. Name the issue, the message and the attachment's part id, and the file lands on the issue under the sender's file name and type, without passing through the conversation or being downloaded.

The part id is the one to use, not the attachment id. Gmail issues a new attachment id every time a message is read, so an id copied from one read does not match the next; the part id stays the same, and `gmail_read` now lists it beside each attachment.

Each call moves one file, up to 25 MB, and answers with the same receipt as before: the attachment's name and size, the SHA-256 and byte count of what was sent, and the issue it went to. An email with three PDFs is three calls. See [Moving files between services](/docs/file-references). The story behind it, and where the file is while it moves: [Claude can file an email on a Jira issue now](/blog/email-to-jira-file-references).
