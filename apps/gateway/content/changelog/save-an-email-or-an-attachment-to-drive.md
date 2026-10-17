---
title: "Save an email or an attachment to Drive, with a checksum of what Drive stored"
date: "2026-10-13"
tags: ["drive", "gmail", "files"]
---

`drive_upload_file` takes the same file reference `jira_add_attachment` and `file_download_link`
take, an email or one of its attachments, and puts the file into Google Drive under its own name.
Pass a folder id to choose where it goes; without one it lands in the root of My Drive.

The receipt can say something the Jira one cannot: Drive computes its own SHA-256 of the file it
stored, and the receipt sets it beside the SHA-256 of what was sent, with `checksum_match` saying
whether they agree. If they do not, the call answers with an error and the full receipt, and the
file stays in Drive for you to look at.

The receipt also names the folder's owners, whether it is shared and whether it is in a shared
drive, next to the account that received the file, so a folder that belongs to someone else is
visible before you rely on it.

The email can come from one connected Google account and go into the Drive of another. The file's
content never enters the conversation and is never written to our disks.

Details are on the [file references page](/docs/file-references). The story behind it: [Save the Email
to Your Own Computer, With a Checksum You Can Check](/blog/save-the-email-to-your-own-computer).
