---
title: "A File on Your Computer, Into Drive, Jira or an Email, Without Passing Through the Chat"
excerpt: "Two ways to hand DataToRAG a file from your own machine: in the call for small files, or through a single-use upload link for anything up to 25 MB. Both come back with a byte count and a SHA-256, and the file is never written to our disks."
searchTitle: "Upload a File From Your Computer to Drive or Jira via Claude"
searchDescription: "DataToRAG takes a file from your computer through a single-use upload link, up to 25 MB, or in the call, up to 1 MB, and returns its size and SHA-256."
date: "2026-10-25"
updated: "2026-11-25"
updatedNote: "November 25, 2026: the ten-attachment limit on one email is ours, not Gmail's, and the post now says so; the section on other connectors is cut back to what Anthropic's and Atlassian's own pages say on this date, which drops the 25 MB cap, the missing receipt, and the short-lived token that neither page states."
author: "Manuel Yang"
category: "Product"
coverImage: "/blog/inbound-files-cover.png"
tags: ["file-references", "drive", "jira", "gmail", "uploads", "claude-code"]
---

DataToRAG takes a file from your own computer in two ways: `file_upload_link` makes a single-use link that accepts a file of up to 25 MB without it passing through the conversation, and a file your agent already holds goes in the call, up to 1 MB. Either can then go to `drive_upload_file`, to `jira_add_attachment`, or onto an email as an attachment.

Every file tool on DataToRAG used to take a reference: an email, an attachment, a Drive file. The file had to already live in a connected service. A screenshot on your laptop, a PDF someone sent you on Slack, an export from a tool we do not connect, none of them had a way in. On October 22 I needed to put one image into two emails and the only route was to publish it somewhere with a URL first.

Both halves of the fix are live. This post is what they do, where the file is at each step, and what the other connectors do with the same problem.

## Two ways in

**In the call.** When Claude already holds the file, an image you shared in the chat for example, it can send the bytes with the call as a `content` reference: a name, a type, and the file as base64. `drive_upload_file` and `jira_add_attachment` take it, and so do the email tools as an attachment. The cap is 1 MB decoded. That cap is about the model, not the transport: the model has to type the base64 out as its answer, and a 50 KB image is 65,000 characters of it. Above 1 MB the tool refuses and names the other way.

**Through a link.** Ask for an upload link and `file_upload_link` answers with a URL on datatorag.com and a one-line command:

```
curl -fsS -T ./report.pdf "https://datatorag.com/files/u/<token>/"
```

In a terminal, run the line. In a browser, open the link: a page with a drop zone, one Upload button, a progress bar, and then the receipt and a short reference to paste back into the conversation. The link takes one file, once, within ten minutes, up to 25 MB. Claude then uses the reference the same way it uses any other file reference.

![The upload page at phone width after an upload, and the curl receipt](/blog/inbound-files-cover.png)

Several files can ride one email: an email's attachments can mix Drive files, uploaded files and files sent in the call, up to ten attachments and 25 MB together. Both limits are ours.

## What you get back

Every path answers a receipt: the file's name, its byte count and its SHA-256 as we received it, and for Drive the checksum Drive computed over what it stored and whether the two agree. The receipt is the check. The file's content is never in the conversation, so the hash is what lets you confirm the thing in Drive is the thing on your disk.

```
shasum -a 256 report.pdf
```

## Where the file is

The gateway is a corridor, not a shelf. A file sent in the call is decoded in memory, handed to the destination and dropped. A file sent through a link is held in memory for at most ten minutes after it arrives, goes to exactly one call, and is dropped. Nothing is written to our disks at any point. A second use of a reference is refused in words; a link that is pasted into a tool call is cancelled, so a link stays yours.

## What the other connectors do

I looked at how other connectors take a file before building this, in October 2026. What follows is only what their own pages say as of November 25, 2026. Anthropic's help page for Claude's Google connectors says the Drive connector can "upload any file type"; it does not say how the bytes travel or give an upload size, and it does not mention a checksum. Atlassian's page for its own MCP server lists a Jira tool that will "attach a local file" to a work item and a Confluence tool that will "prepare an attachment upload and return a local curl command," so there the bytes go from the agent's shell to Atlassian. Those are the two shapes: in the call, or around it. We built both, and added the receipt.

## Limits

- One file per link, 25 MB, ten minutes, one use. Three links or held files waiting per account at a time.
- 1 MB decoded for a file sent in the call.
- One file per call into Drive and onto a Jira issue; several per email.
- An upload link counts as one tool call when it is made. The upload itself is not a call.

## Try it

- "Make me an upload link for the contract PDF, then attach it to PROJ-42."
- "Put this screenshot into my Receipts folder in Drive."
- "Email the two spreadsheets on my desktop to Sam, with the Q3 deck from Drive."

The tool list, the receipt fields and the refusals are on the [file references page](/docs/file-references). The two changelog entries are [Put a file Claude already has into Drive or onto a Jira issue](/changelog#send-a-file-you-already-have) and [Upload a file from your computer](/changelog#upload-a-file-from-your-computer).
