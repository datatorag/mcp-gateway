---
title: "How a File Should Move Through an MCP Server (and Why Ours Never Sees the Bytes)"
excerpt: "We designed Gmail attachments three ways and built one: a Drive file id, not base64 through the model. The arithmetic behind that choice, where the MCP spec went, and what DataToRAG shipped since."
searchTitle: "How Files Should Move Through an MCP Server | DataToRAG"
searchDescription: "Why DataToRAG's Gmail attachments take a Drive file id and not base64: the token cost of bytes through the model, and where the MCP spec is heading."
date: "2026-09-28"
updated: "2026-11-25"
updatedNote: "November 25, 2026: the limits section and the plan at the end now carry dated notes saying what shipped (a file the agent holds, up to 1 MB in the call; a single-use upload link, up to 25 MB, that returns an upload reference and not a Drive id). The two spec proposals are restated from their own pull requests as read today: SEP-2356 was closed on June 26, 2026, and SEP-2631 on October 14, 2026, in favor of an extension. A sentence about the built-in Drive connector's upload tool and two comparisons to Gmail's internals that we could not confirm on the vendors' pages are removed. The statements about how Claude's clients handle a file a person attaches, including the closing line that asked for a client that passes attached bytes to a tool, are removed because we could not re-test them, the base64 cost is restated as character arithmetic with no figure for any vendor's tokenizer, and the excerpt is rewritten, because it promised an account of what a client hands a tool when a person attaches a file and the post no longer contains one. November 17, 2026: this post says a file has to be in Drive and that bytes in the call are a dead end. Since late October 2026 we take both: a file Claude already holds in the call, capped at 1 MB for the token reasons given here, and a file on your computer through a single-use upload link up to 25 MB. The reasoning stands; the limits section does not. See /blog/a-file-on-your-computer-into-drive-jira-or-an-email."
author: "Manuel Yang"
category: "Engineering"
coverImage: "/blog/attachments-three-designs.png"
tags: ["mcp", "attachments", "files", "drive", "engineering"]
---

Last week we shipped attachments for the Gmail tools. [The announcement is its own post](/blog/gmail-attachments-from-drive). This one is the design notebook underneath it, because the question "how does a file get from the user to the tool" turned out to have no settled answer in the MCP world, and we had to pick one.

## Three designs, one survivor

![Three designs: the model hands us base64 bytes (cut at design), a URL (cut at design), or a Drive file id, where the gateway pulls from Drive and uploads to Gmail (shipped)](/blog/attachments-three-designs.png)

**Design 1: the model hands us the bytes.** An `attachments` entry with `filename`, `mime_type` and `content_base64`. Every MCP tutorial's first draft looks like this and ours did too, in the spec. It never reached the code: the arithmetic below killed it at the design review.

**Design 2: the model hands us a URL.** We fetch it. Works for public files, fails for everything a business actually sends, which lives behind a login. Also cut on paper.

**Design 3: the model hands us a Drive file id.** We pull the bytes from Drive with the user's own token and stream them into the message. This is what shipped, and it is the only one that was ever written.

The reasons are below. None of them is "it was easier". Design 1 would have been easier.

## Why base64 through the model is a dead end

Two facts, one from arithmetic and one from what the field asks the model to do.

**The arithmetic.** Base64 turns every three bytes into four characters, so a file is a third bigger before it goes anywhere. A 200 KB screenshot is about 267,000 characters. A 2 MB photo is about 2.7 million. In a `content_base64` field every one of those characters is model output. The customer whose ask started this mostly sends documents and zip files. A zip is already compressed, so there is nothing left to squeeze.

The result is a path that works in the demo and fails in the first real week, which is worse than no path. A user who hits it once does not try attachments again.

**The copying.** A base64 field also turns the model into a copier. Whatever the model has of a file, the field wants all of it written back out exactly, character for character. So design 1 does not just cost too much, it asks a model to reproduce two megabytes of base64 without one slip, and our server would have no way to tell a good copy from a bad one. Every character it gets wrong corrupts the file silently, and a zip with one wrong byte is not a zip.

## What the spec is doing about it

The MCP spec has been working through the same question in public, and the timeline is instructive.

The first proposal was SEP-2356: a tool declares a file-typed argument, the client fills it with a data URI, and the bytes ride inside the tool call. As of November 25, 2026, its pull request shows it closed on June 26, 2026, with the note "Closing in favor of #2631 which will likely be the more durable solution." That is our design 1, and it did not go forward.

The replacement was SEP-2631, "File Objects and Transfer". The shape: a `files/authorizeUpload` request returns a transfer descriptor, the bytes go over HTTPS directly, and the tool gets a file URI. Its summary says the methods "authorize HTTPS transfer descriptors while keeping bytes out of JSON-RPC payloads." As of November 25, 2026, that pull request is closed as well: it was closed on October 14, 2026, in favor of a file-uploads extension. Whatever comes of that, a server that wants files today has to find a handle the model can already produce.

## A Drive id is already an opaque handle

That is the whole insight, and it is small. Every Google Workspace user already has a file store the model can search and name. `drive_search` returns ids. The user says "attach the Q3 report" and the model says `{file_id: "1AbC..."}`. Our server does the rest with the user's token: metadata call for size and type, a refusal before any download if a file Drive knows the size of would take the message over 10 files or 25 MB (an export has no size until Google renders it, so it is counted as it streams and stopped before send if it goes over), then a streaming download into a MIME part, then one upload to Gmail, resumable above 5 MB.

Native Google files got their own treatment, because "attach a Google Doc" means two different things. Passed by id alone, a Doc goes in as a link, which is how Gmail's own compose sends one (as of November 25, 2026, Google's Gmail help says the attachment option "only works for files that weren't created using Google Docs, Sheets, Slides, or Forms") and what the recipient usually wants: the live document. Passed as `{file_id, as: "pdf"}`, Google renders the export and we stream that. Docs export to pdf, docx, txt, html, md, rtf, odt and epub; Sheets to xlsx, csv, tsv, pdf, html (which Google delivers as a zip of one page per tab) and ods; Slides to pptx, pdf, txt and odp. A csv is one tab, so you name it and the response says which one went.

Inline images use the same handle: reference a Drive file in the HTML as `cid:` plus its filename and it becomes a `multipart/related` part with a Content-ID, the standard way an email carries an inline image. No hosted URL, so nothing gets shared "to anyone with the link" as a side effect.

Total bytes through the model for a 9 MB attachment: the length of a Drive id, about 33 characters.

![A Gmail draft written by the connector: a PDF and an xlsx export attached, a Google Doc linked in the body, the logo inline](/blog/gmail-draft-attachments.png)

## What it costs

*Since late October 2026 this section is no longer the limit. A file the agent already holds goes in the call, up to 1 MB, and a file on your computer goes through a single-use upload link, up to 25 MB. See [a file on your computer into Drive, Jira, or an email](/blog/a-file-on-your-computer-into-drive-jira-or-an-email). What follows is the limit as it stood in September.*

Honesty section. The file had to be in Drive. A screenshot pasted into the chat could not reach an email through our tools, and our docs said so rather than implying otherwise. The workaround was one step: put it in Drive, tell Claude the name. For that customer's docs and zips, which live in Drive already, there is no step.

The other cost is that we depend on Drive's export renderer for native files. A Doc exported as md is Google's markdown, and a Sheet exported as csv is one tab. Both are documented, neither is something we can fix.

## What comes next

*What shipped in late October 2026 differs from this plan. `file_upload_link` makes a link that takes one file, once, up to 25 MB, and stops working ten minutes after it is made. One `curl -T` sends the file, and what comes back is an upload reference to pass as the attachment, not a Drive id. [File references](/docs/file-references) has the details. The plan as written in September:*

An upload endpoint shaped like SEP-2631: post a file to the gateway with your token, get a Drive id back, attach by id. In Claude Code that is one `curl -F` in a skill, and it covers the 20 MB PDF on your disk that was never in Drive. When the spec lands and clients implement it, the endpoint becomes the standard mechanism and the Gmail tools do not change, because they only ever wanted a handle.

If you run an MCP server and are about to add a `content_base64` field, this is the post I wish had existed before we did.
