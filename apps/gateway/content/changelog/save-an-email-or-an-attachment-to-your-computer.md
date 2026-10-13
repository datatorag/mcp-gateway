---
title: "Save an email or an attachment to your computer from a link"
date: "2026-10-13"
tags: ["gmail", "files"]
---

A file reference can now go to your own disk. `file_download_link` takes the same reference
`jira_add_attachment` takes, an email or one of its attachments, and answers with a link that
saves the file to your computer.

The link opens a page with the file's name, its size and one button. The button saves the file.
A link works once and lasts ten minutes. If you work in a terminal, the receipt also carries a
one-line command that saves the file without the page.

The receipt gives the size in bytes and the SHA-256 of the file, so you can check your copy with
`shasum -a 256`, `sha256sum` or `Get-FileHash`. The file is the unmodified original: a message
exactly as Gmail returns it in raw form, or an attachment's own bytes. Before it is sent it is
read again and compared with the receipt, and if it no longer matches, nothing is sent.

The file's content never enters the conversation and is never written to our disks. It is held
in memory only while it is being read. For up to twenty minutes after a link is made we keep what
identifies the file (the message it names and the account it is in, its name, size and SHA-256),
and none of its content.

A link is for you. A call to any DataToRAG tool that carries one of your unused links is refused
and the link is cancelled. In a chat with the DataToRAG agent you are asked before a link is
made, and a skill run cannot make one.

Details and limits are on the [file references page](/docs/file-references).
