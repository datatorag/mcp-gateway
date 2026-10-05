---
title: "Attach an email to a Jira issue, as the original file"
date: "2026-10-05"
tags: ["jira", "gmail", "tools"]
connector: "atlassian"
---

Putting an email on a Jira issue used to mean downloading the message from Gmail and uploading it to Jira by hand. `jira_add_attachment` does it in one call: name the issue and the Gmail message, and the email's original `.eml` file lands on the issue.

The file is the message exactly as Gmail returns it, the same bytes as Gmail's own Download message. Its content never passes through the conversation. It is held in the gateway's memory only while the transfer runs, and is never written to our disks.

The answer is a receipt: the attachment's name and size, the SHA-256 and byte count of what was sent, and the issue's key, project and summary, so you can see what went where. One file per call, up to 25 MB.

This is the first of a general way to move files between connected services; see [Moving files between services](/docs/file-references).
