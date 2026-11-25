---
title: "Claude Can Edit Your Google Docs and Sheets Now. Here Is What It Still Cannot Do."
excerpt: "Since October 2026 Claude has Google Docs and Sheets connectors of its own, and as of November 25, 2026 Anthropic's help page lists Slides with them: they create and edit files in place. What DataToRAG adds: a file moved between services, two Google accounts in one request, a query over a sheet, and the same tools in Cursor or your own app."
date: "2026-04-21"
updated: "2026-11-25"
updatedNote: "November 25, 2026: eighth note. Re-read against Anthropic's help page: it lists a Slides connector that creates and edits decks (it cannot add charts), shows no beta label on Docs, Sheets, or Slides, says Claude reads and works with comments in Docs, and says the Google connectors are on Claude and Claude Desktop. So the Slides rows, the comments row, the beta wording, and the short answer are corrected. The rows that said No for a sheet query and for two Google accounts now say the page does not describe them, which is all we can source. The Drive Cataloging row and paragraph are removed because we could not find Anthropic's page for it today. And the line that every write asks you first now says where: in a conversation with our dashboard Agent. The three bullets from our October 15, 2026 check are put in the past tense, because Anthropic's page lists no tools and does not say whether a sheet can be queried. Earlier, seventh note, one row is removed. The table said Claude's own connectors could not put an email's attachment in Drive or on your computer. As of November 25, 2026, the Gmail connector's own tool list has a download for an attachment, to read or save it, and the Drive connector uploads a file by reference, so that row no longer describes a difference. Moving a file between two Google accounts in one request is still covered by the row above it. Earlier, sixth note, October 19, 2026: two rows flip to Yes for us and one is added. We read a file's sharing permissions and share a file with someone since October 19, 2026, and we move a file between folders since October 16, 2026, which this table still denied. Earlier, fifth note, October 15, later the same day. The central claim of this post is no longer true. Claude's Google Docs and Sheets connectors, in beta on claude.ai since October 2026 and enumerated on 15 October 2026, edit files in place: Sheets writes values and formulas, appends, clears, inserts rows and columns and runs the full batch update; Docs runs a full batch update, including tracked suggestions. So the title, the short answer, the table and the sections built on the old gap are rewritten. The original title was 'Claude Can Read Your Google Docs. It Can't Edit Them.' The Drive connector itself still changes no file's content, and the Slides connector had not been enumerated, so the Slides rows stand as they were. Earlier, fourth note, October 15. Anthropic announced Docs, Sheets and Slides editing connectors in beta on 6 October 2026. As of 15 October 2026 they were not available on our account, so what this post says about them is what we could verify ourselves. We will re-test and correct this the day they reach us. Earlier, the third correction, October 9. Two things changed in the comparison. We copy files now, so 'Copy an existing file' reads Yes for both. And the native connector can rename a file, move it to another folder or put it in the trash, so 'everything it writes is a new file' was too broad and is narrowed to what still holds: it cannot change what is inside a file you already have. Earlier: a second correction, in the same direction as the first. July 30 fixed an excerpt that called the native connector 'effectively read-only'. Re-enumerating it on August 11 shows two more places this post understated it: creating files needs no code execution, it is a first-class Drive tool that makes Docs, Sheets, presentations and folders, so the folders row that said No for them was wrong, and the table never mentioned copying files or reading sharing permissions, which they do and we do not. The thesis is unchanged and was re-checked: nothing in the native surface edits a file that already exists."
author: "Manuel Yang"
category: "Comparison"
coverImage: "/blog/drive-comparison.png"
tags: ["google-drive", "google-docs", "sheets", "slides", "claude", "comparison", "google-workspace"]
---

**Short answer:** yes, for Docs and Sheets since October 2026, and for Slides as of November 25, 2026. [Anthropic's help page](https://support.claude.com/en/articles/10166901-use-google-workspace-connectors) lists separate Docs, Sheets, and Slides connectors that create new files and edit existing ones, with no beta label, and names one limit: Claude cannot add charts to Google Slides. When we enumerated the Docs and Sheets connectors on October 15, 2026, they were in beta and edited a file you already had: a cell, a formula, a new row, a tab, formatting, a paragraph, a tracked suggestion. The Drive connector handles searching, uploading, and sharing. What is left for DataToRAG is the space between services and accounts: an email's attachment onto a Jira issue, into Drive or onto your computer with a checksum, two Google accounts in one request, a query over a sheet, and the same tools in Claude Code, Cursor or your own app.

This post used to have a different title and a simpler argument. Claude could read your quarterly report and could not fix the typo in it, and that gap was the whole post. It closed in October 2026, and pretending otherwise would make everything else here harder to trust.

## What the built-in connectors do now

**As of November 25, 2026,** Anthropic's help page lists four connectors that touch your files: Drive, Docs, Sheets, and Slides. It says the last three create new files and edit existing ones live in a pane beside the chat, on Claude on the web and Claude Desktop. The detail below is older: it is what we enumerated on October 15, 2026, when there were three and the Slides connector had not reached us.

- **Google Sheets** had nine tools on the Sheets API: values in and out, formulas, appending, clearing, inserting rows and columns, copying a tab to another spreadsheet, and the full batch update, which covered tabs, formatting, and charts. It read one range per call, and it had no query language on that date.
- **Google Docs** had two: one read, and one batch update that inserted, deleted, replaced, and styled text, and could write as tracked suggestions instead of direct edits.
- **Google Drive** found, read, created, copied, renamed, moved, and trashed files, and told you who a file was shared with. It changed nothing inside one.

All of this was enumerated on October 15, 2026. Both new connectors were in beta then; Anthropic's page shows no beta label on November 25, 2026.

## Feature comparison

| Capability | Claude built-in (Drive, Docs, Sheets) | DataToRAG Google Workspace |
|---|---|---|
| Search and read Google Docs, Sheets, Slides | Yes | Yes |
| Edit an existing Google Doc in place | Yes | Yes |
| Update Sheet cells or append rows | Yes | Yes |
| Query a sheet with a filter | Not described on Anthropic's page | Yes |
| Edit an existing Slides deck | Yes, without adding charts (November 25, 2026) | Yes |
| Create a new Doc or Sheet, with content | Yes | Yes |
| Create a new Slides deck | Yes | Yes |
| Create folders in Drive | Yes | Yes |
| Copy an existing file | Yes | Yes |
| Rename a file | Yes | Yes |
| Move a file to another folder | Yes | Yes |
| Read a file's sharing permissions | Yes | Yes |
| Share a file with someone | Yes | Yes |
| Comments on files | Reads and works with comments and suggestions in Docs (November 25, 2026) | No |
| Docs added to a Claude project stay in sync with Drive | Yes | No |
| Two Google accounts in one request | Not described on Anthropic's page | Yes |
| Where the tools run | Claude and Claude Desktop | Claude Code, Cursor, or your own app as well |

"Query a sheet" means a filter or aggregate run over the data, the way a QUERY formula would, rather than reading a range and working it out in the chat.

The built-in column is what we enumerated on October 15, 2026, except the rows that changed on November 25, 2026, which are from Anthropic's help page as it read that day. "Not described" means that page does not say either way, so test it before you rely on it.

## The write side of ours

- `docs_create`, `docs_write`, `docs_batch_update`: create a Doc, write it, or apply a sequence of edits to one that exists.
- `sheets_update`, `sheets_append`, `sheets_query`: write ranges, add rows, and run a filter or aggregate over a sheet.
- `slides_create`, `slides_batch_update`: build a deck with content, and edit one that exists.
- `jira_add_attachment`, `drive_upload_file`, `file_download_link`: take an email, or an attachment inside it, to a Jira issue, into Drive or onto your computer, with the SHA-256 of what was sent.

Every tool takes an account, so a work inbox and a personal Drive are one request. In a conversation with our dashboard Agent, every write asks you first; a skill you start runs its writes without stopping to ask, and from your own client the approval prompt is that client's.

## Where each one fits

If the job is editing a Doc, a Sheet, or a deck you already have, in Claude, on one Google account, the built-in connectors now do it, and they come with Claude. Use them.

DataToRAG is for the work that crosses a line: a file that has to go from Gmail to Jira, a report that reads one account and writes another, a sheet you want to query rather than scroll, or the same tools in Claude Code, Cursor or an application of your own.

DataToRAG does not index your Drive for search across a large corpus. If your workflow is "search across 50,000 documents," this is the wrong tool.

## Try it

Connect your Google account at [datatorag.com/dashboard](https://datatorag.com/dashboard).
