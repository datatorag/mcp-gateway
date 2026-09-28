---
title: "Attach Drive files to the mail your assistant sends"
date: "2026-09-27"
tags: ["gmail", "drive", "gws-mcp"]
connector: "google-workspace"
---

`gmail_send`, `gmail_reply`, `gmail_forward`, `gmail_create_draft` and `gmail_update_draft` take an `attachments` list. Each entry is a Drive file id. A PDF, an image or any other file is attached as it is. A Google Doc, Sheet or Slides deck passed by id alone goes in as a link in the body, the way Gmail's own compose does it; pass `{file_id, as: "pdf"}` to attach an export instead. Docs export as pdf, docx, txt, html, md, rtf, odt or epub; Sheets as pdf, xlsx, csv, tsv, html or ods; Slides as pdf, pptx, txt or odp. csv and tsv export one tab: add `tab` to choose it, and the response says which tab went.

**Inline images.** Reference a file in `html_body` as `<img src="cid:FILENAME">` and it renders in place instead of as an attachment at the bottom, the same structure Gmail builds when you paste an image into a message.

**Forwarding carries the original's files.** `gmail_forward` now includes the forwarded message's own attachments, counted in the limit. Pass `include_original_attachments: false` to forward the text alone.

**Limits and refusals.** At most 10 files and 25 MB per message. A refusal comes before any download and names the file and the cap. Two attachments may not share a filename.

**Drafts with files are signed.** `gmail_send_draft` adds your Gmail signature to a draft that holds files, the way it already does for plain drafts. Updating a draft replaces it whole: files it held are dropped unless you pass them again.

**The response says what happened.** Each entry is reported as `attached`, `inline`, `linked` or `exported`, with its size or link.

Files come from Drive only. To send something that is not in Drive yet, put it there first and pass its id.
