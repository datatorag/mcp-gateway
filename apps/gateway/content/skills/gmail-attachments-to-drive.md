---
title: "Save recurring email attachments to Drive with Claude"
order: 4
situation: "The same report lands in my inbox every week and I file it by hand, or I forget to."
produces: "Attachments filed into the right Drive folder, without the files ever passing through the conversation."
tools: [gmail_search, gmail_read, gmail_save_attachment_to_drive, drive_create_folder]
accounts: single
---

# Filing the attachment, not reading it

This used to be an Apps Script. Someone wrote it, it worked, and then it
quietly broke and nobody noticed for a month.

The interesting part is what does not happen: the attachment never enters the
conversation. It goes from Gmail to Drive server-side, so a 5MB spreadsheet
costs you nothing in context.

```markdown
---
name: attachments-to-drive
description: File recurring email attachments into Drive folders
---

# Attachments to Drive

## Find the mail, not the attachment

Search narrowly. `gmail_search` with the sender and a file condition:

    from:reports@vendor.example has:attachment newer_than:14d

Prefer `from:` and `subject:` over body text. Recurring reports are recurring
precisely because they come from the same place with the same subject.

## Read only if you need to decide

`gmail_read` with `text_only: true` when you need the body to route the file —
a period, an invoice number, which region it covers.

DO NOT read a message without `text_only` when it has attachments. The raw
MIME payload includes the attachment base64-encoded, and base64 is about a
third larger than the file. A 5MB CSV arrives as roughly 6.7MB of text, which
is a whole context window spent on a file you were never going to read.

The compact view still lists each attachment's filename, mimeType and
attachmentId, which is everything you need to file it.

## File it

`drive_create_folder` first if the destination does not exist. Then
`gmail_save_attachment_to_drive` with the message id, the attachment id and
the folder id.

The file moves Gmail to Drive server-side. Nothing about its contents reaches
this conversation, which is the point — you are filing it, not reading it.

## Rules that keep this from going wrong

1. **One folder per cadence, not per file.** `2026/Q3/vendor-reports`, not a
   folder per report. You are building somewhere to look, not an archive of
   directories.
2. **Check before you create.** Creating a folder that already exists gives
   you two folders with the same name and no error, and Drive will let you
   keep doing it.
3. **Never search the whole mailbox.** `has:attachment` alone matches years of
   mail. Always bound it with a sender and a date.
4. **File, then confirm, then mark.** If you also mark the mail read, do it
   after the file lands, not before — otherwise a failure leaves you with a
   read message and no file, which is invisible.
```

## Notes from running this

**The base64 arithmetic is the whole reason this tool exists.** Attachments are
base64-encoded in the MIME payload, which inflates them by roughly a third.
Reading one 5MB attachment the naive way costs about 6.7MB of context. The
save-to-Drive path never puts the bytes in the conversation at all, so the
cost is the same whether the file is 5KB or 50MB.

**Responses are truncated before they can overflow.** The connector caps tool
responses around 900KB because MCP starts failing near 1MB. That is a
backstop, not a plan — a truncated response is a response you cannot trust,
so the fix is to not ask for the payload in the first place.

**`text_only` is not just smaller, it is differently shaped.** It flattens the
headers and gives you attachment metadata as a list. Getting the same
information out of the raw payload means walking a nested MIME tree.
