---
title: "Your Agent Can Attach Files to Email Now. The Interesting Part Is Where the Bytes Never Go."
excerpt: "Gmail send, reply, forward and drafts take attachments from Drive: real files attached, Google Docs linked the way Gmail does it or exported as PDF and Word, images inline. The design question underneath is one the MCP spec itself hasn't settled yet, and we picked a side."
searchTitle: "Attach Google Drive Files to Gmail With Claude | DataToRAG"
searchDescription: "DataToRAG's Gmail send, reply, forward, and draft tools attach files from Google Drive, link or export Google Docs, and place images inline."
date: "2026-09-28"
updated: "2026-11-25"
updatedNote: "November 25, 2026: the section on what it means for you today no longer says a screenshot from the chat cannot be attached, and the planned upload endpoint that would return a Drive id is now described as what shipped (a single-use upload link that returns an upload reference). The statement about how Gmail sends a Google Doc is dated and tied to Google's help page, and a comparison to how Gmail builds inline images is removed. The statement about what Claude does with a file a person drops into the chat is removed because we could not re-test it, and the base64 cost is restated as character arithmetic. November 17, 2026: when this was written a file had to be in Drive first. Since late October 2026 a file Claude already holds (up to 1 MB) or a file on your computer (up to 25 MB, through a single-use upload link) can be attached too."
author: "Manuel Yang"
category: "Product"
coverImage: "/blog/gmail-draft-attachments.png"
tags: ["gmail", "drive", "attachments", "mcp", "google-workspace"]
related: ["connect-google-workspace-to-claude", "how-files-should-move-through-an-mcp-server", "a-file-on-your-computer-into-drive-jira-or-an-email"]
---

A customer wrote in two weeks ago with two asks about the Gmail tools. Mail Claude sent was missing his signature, and drafts came out without attachments. The signature shipped on the 18th. This is the other one. His workflow is that Claude drafts the email, he opens it in Gmail, checks it, presses send. Half of what he sends has a file on it, and until this week the draft came out with no file, so he was fixing that by hand too.

As of today, `gmail_send`, `gmail_reply`, `gmail_forward`, `gmail_create_draft` and `gmail_update_draft` take an `attachments` list. Open the draft in Gmail and it looks like something you attached yourself.

## What it does

Each entry is a Drive file. A PDF or an image or a zip goes on as an attachment, the way you'd expect. A Google Doc, Sheet or Slides deck by itself goes in as a link in the body, which is how Gmail's own compose sends one (as of November 25, 2026, Google's Gmail help says the attachment option "only works for files that weren't created using Google Docs, Sheets, Slides, or Forms"), and the recipient gets the live document. If you want a file instead, say so: `{file_id, as: "pdf"}` exports it and attaches the export. Docs also do docx, txt, html and md (markdown); Sheets do xlsx and csv; Slides do pptx. csv exports one tab, so you name the tab, and the response tells you which one went.

![A Gmail draft written by the connector: a PDF and an xlsx export attached, a Google Doc linked in the body, the logo inline](/blog/gmail-draft-attachments.png)

Images can go inline. Reference the file in the HTML body as `cid:` plus its filename and it renders in place instead of hanging off the bottom as a paperclip. That's a MIME `multipart/related` part with a Content-ID, the standard way an email carries an inline image. Not a hosted link, so nothing gets shared to "anyone with the link" behind your back.

Forward now carries the original's attachments by default, because that's what forwarding means to a person. There's a flag to send text only.

Limits: 10 files, 25 MB total. For a file Drive knows the size of, the refusal comes before a single byte is downloaded and names the file and the cap. An export has no size until Google renders it, so it is counted as it streams, and one that goes over stops the message before anything is sent.

## Why the bytes never touch the model

![Claude passes a 33-character file id; the gateway streams the 9 MB file from Drive into the Gmail draft, never through the model](/blog/attachments-where-the-bytes-go.png)

The obvious design has the model hand us the file as base64 in the tool call. It was in the first draft of the spec and cut before a line of it was written. Base64 turns every three bytes into four characters, so a 200 KB screenshot is about 267,000 characters of model output and a 2 MB photo is about 2.7 million. And the field asks the model for an exact copy: one wrong character and the file is corrupt, with nothing in the call to say so.

A Drive id is already an opaque handle. So the model says "attach this id", our server pulls the bytes from Drive with your token and streams them into the message, and nothing large ever passes through the model. The full reasoning, including what the spec's own proposals did with this question, is in [How a File Should Move Through an MCP Server](/blog/how-files-should-move-through-an-mcp-server).

## What it means for you today

*Since late October 2026 a file does not have to be in Drive first: a file Claude already holds (up to 1 MB) or a file on your computer (up to 25 MB, through a single-use upload link) can be attached too. See [a file on your computer into Drive, Jira or an email](/blog/a-file-on-your-computer-into-drive-jira-or-an-email).*

Going the other way, from an email's attachment into a Drive folder, is an older tool with [its own post](/blog/connect-google-workspace-to-claude).

If the file is in Drive, or already on an email you're forwarding, it works. When this was written, a screenshot you pasted into the chat did not, and the answer was "put it in Drive and tell me the name". That is the part that changed: your agent can now put a file it already holds into the call, up to 1 MB.

The next piece, when this was written, was an upload endpoint shaped like the spec draft: hand a file to the gateway, get a Drive id back, attach by id. What shipped is a little different. `file_upload_link` makes a single-use link, one shell command sends the file to it, and what comes back is an upload reference that goes into `attachments`, not a Drive id. It covers the 20 MB PDF on your disk. [File references](/docs/file-references) has the details.

## How we know it works

This shipped behind the admin test runner we added this month, which runs the connector's deterministic cases against production in about a minute. Two of its cases send a 9 MB attachment through the new transport and save it back to Drive with a checksum match, and the whole suite ran against production before and after: 194 results compared, nothing changed. And one live draft to a test account with a PDF attached, a Doc linked, the same Doc exported, a sheet as xlsx and a logo inline, opened in Gmail by a person, which is the check that matters for the customer who asked.

If you've got a workflow where the file starts somewhere other than Drive, reply and tell me where. That's what decides the shape of the upload endpoint.
