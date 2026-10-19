---
title: "Claude Can Edit Your Google Docs and Sheets Now. Here Is What It Still Cannot Do."
excerpt: "Since October 2026 Claude has Google Docs and Sheets connectors of its own, in beta, and they edit files in place. What they do not do: move a file between services, work two Google accounts at once, query a sheet, or follow you outside claude.ai."
date: "2026-04-21"
updated: "2026-10-19"
updatedNote: "sixth note, October 19, 2026: two rows flip to Yes for us and one is added. We read a file's sharing permissions and share a file with someone since October 19, 2026, and we move a file between folders since October 16, 2026, which this table still denied. Earlier, fifth note, October 15, later the same day. The central claim of this post is no longer true. Claude's Google Docs and Sheets connectors, in beta on claude.ai since October 2026 and enumerated on 15 October 2026, edit files in place: Sheets writes values and formulas, appends, clears, inserts rows and columns and runs the full batch update; Docs runs a full batch update, including tracked suggestions. So the title, the short answer, the table and the sections built on the old gap are rewritten. The original title was 'Claude Can Read Your Google Docs. It Can't Edit Them.' The Drive connector itself still changes no file's content, and the Slides connector had not been enumerated, so the Slides rows stand as they were. Earlier, fourth note, October 15. Anthropic announced Docs, Sheets and Slides editing connectors in beta on 6 October 2026. As of 15 October 2026 they were not available on our account, so what this post says about them is what we could verify ourselves. We will re-test and correct this the day they reach us. Earlier, the third correction, October 9. Two things changed in the comparison. We copy files now, so 'Copy an existing file' reads Yes for both. And the native connector can rename a file, move it to another folder or put it in the trash, so 'everything it writes is a new file' was too broad and is narrowed to what still holds: it cannot change what is inside a file you already have. Earlier: a second correction, in the same direction as the first. July 30 fixed an excerpt that called the native connector 'effectively read-only'. Re-enumerating it on August 11 shows two more places this post understated it: creating files needs no code execution, it is a first-class Drive tool that makes Docs, Sheets, presentations and folders, so the folders row that said No for them was wrong, and the table never mentioned copying files or reading sharing permissions, which they do and we do not. The thesis is unchanged and was re-checked: nothing in the native surface edits a file that already exists."
author: "Manuel Yang"
category: "Comparison"
coverImage: "/blog/drive-comparison.png"
tags: ["google-drive", "google-docs", "sheets", "slides", "claude", "comparison", "google-workspace"]
---

**Short answer:** yes, for Docs and Sheets, as of October 2026. Claude's Google Docs and Sheets connectors, in beta on claude.ai and enumerated on 15 October 2026, edit a file you already have: a cell, a formula, a new row, a tab, formatting, a paragraph, a tracked suggestion. The Drive connector itself still changes no file's content; it reads, creates, copies, renames, moves and trashes. The Slides connector had not been enumerated when this was written, so the Slides rows below are as we last verified them. What is left for DataToRAG is the space between services and accounts: an email's attachment onto a Jira issue, into Drive or onto your computer with a checksum, two Google accounts in one request, a query over a sheet, and the same tools in Claude Code, Cursor or your own app.

This post used to have a different title and a simpler argument. Claude could read your quarterly report and could not fix the typo in it, and that gap was the whole post. It closed in October 2026, and pretending otherwise would make everything else here harder to trust.

## What the built-in connectors do now

Three of them touch your files, and they divide the work.

- **Google Sheets** has nine tools on the Sheets API: values in and out, formulas, appending, clearing, inserting rows and columns, copying a tab to another spreadsheet, and the full batch update, which covers tabs, formatting and charts. It reads one range per call, and it has no query language.
- **Google Docs** has two: one read, and one batch update that inserts, deletes, replaces and styles text, and can write as tracked suggestions instead of direct edits.
- **Google Drive** finds, reads, creates, copies, renames, moves and trashes files, and tells you who a file is shared with. It still changes nothing inside one.

All of this was enumerated on 15 October 2026. Both new connectors are in beta.

## Feature comparison

| Capability | Claude built-in (Drive, Docs, Sheets) | DataToRAG Google Workspace |
|---|---|---|
| Search and read Google Docs, Sheets, Slides | Yes | Yes |
| Edit an existing Google Doc in place | Yes | Yes |
| Update Sheet cells or append rows | Yes | Yes |
| Query a sheet with a filter | No | Yes |
| Edit an existing Slides deck | No (last verified 9 October 2026) | Yes |
| Create a new Doc or Sheet, with content | Yes | Yes |
| Create a new Slides deck | Yes, but it arrives empty | Yes, with content |
| Create folders in Drive | Yes | Yes |
| Copy an existing file | Yes | Yes |
| Rename a file | Yes | Yes |
| Move a file to another folder | Yes | Yes |
| Read a file's sharing permissions | Yes | Yes |
| Share a file with someone | Yes | Yes |
| Add comments to files | No | No |
| Real-time sync of Docs in Claude Projects | Yes | No |
| Drive Cataloging / RAG indexing (Enterprise) | Yes | No |
| Two Google accounts in one request | No | Yes |
| Put an email's attachment on a Jira issue, in Drive, or on your computer | No | Yes |
| The same tools in Claude Code, Cursor or your own app | No | Yes |

"Query a sheet" means a filter or aggregate run over the data, the way a QUERY formula would, rather than reading a range and working it out in the chat.

## The write side of ours

- `docs_create`, `docs_write`, `docs_batch_update`: create a Doc, write it, or apply a sequence of edits to one that exists.
- `sheets_update`, `sheets_append`, `sheets_query`: write ranges, add rows, and run a filter or aggregate over a sheet.
- `slides_create`, `slides_batch_update`: build a deck with content, and edit one that exists.
- `jira_add_attachment`, `drive_upload_file`, `file_download_link`: take an email, or an attachment inside it, to a Jira issue, into Drive or onto your computer, with the SHA-256 of what was sent.

Every tool takes an account, so a work inbox and a personal Drive are one request. And every write asks you first.

## Where each one fits

If the job is editing a Doc or a Sheet you already have, in claude.ai, on one Google account, the built-in connectors now do it, and they cost nothing. Use them.

DataToRAG is for the work that crosses a line: a file that has to go from Gmail to Jira, a report that reads one account and writes another, a sheet you want to query rather than scroll, or the same tools in Claude Code, Cursor or an application of your own.

Enterprise users also get Drive Cataloging, which indexes content with RAG for fuzzy search across a large corpus. DataToRAG doesn't do that. If your workflow is "search across 50,000 documents," Claude Enterprise is the right tool.

## Try it

Connect your Google account at [datatorag.com/dashboard](https://datatorag.com/dashboard).
