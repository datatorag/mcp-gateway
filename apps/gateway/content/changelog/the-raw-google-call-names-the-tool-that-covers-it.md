---
title: "The raw Google API call names the tool that covers it"
date: "2026-11-19"
tags: ["gws-mcp"]
---

On accounts that have the raw Google API call (`gws_run`), a raw call that one of our named tools
already covers now answers with one line first, naming that tool and what it adds. A raw thread
read, for example, now points at `gmail_read_thread`, which reads every message of the
conversation in one call, keeps the newest messages when a thread is long, and has a headers-only
mode. A raw file copy points at `drive_copy_file`, which converts a PDF or an image to a Google Doc
with OCR, sets the language for it, and puts the copy in a folder you name.

The call still runs, and Google's own answer follows that line unchanged. A raw call that passes
something the named tool cannot take, or that no named tool covers, answers exactly as before.

`drive_copy_file` also now says "OCR" in its description, so an agent looking for text recognition
finds it.
