---
title: "Drive"
description: "Search files, read content, and create folders in Google Drive."
order: 3
section: "connectors"
connector: "google-workspace"
faqs:
  - q: Can DataToRAG read a PDF from Drive?
    a: >-
      No. The Drive read tool answers with an Unsupported file type error for
      PDFs. It reads text out of documents rather than out of scanned or rendered
      pages, which makes PDFs the common surprise.
  - q: Which file types can the Drive reader handle?
    a: >-
      Four kinds. Google Docs, Sheets and Slides come back as extracted text,
      using the same extraction the dedicated tools use; .docx, .xlsx and .pptx
      are converted to the matching Google format in a temporary copy that is
      read and then deleted; .txt and .csv are returned as they are. Anything
      else, PDFs included, returns an Unsupported file type error.
  - q: Does reading a Drive file download it to my computer?
    a: >-
      No. Reading happens server-side and the text comes back in the response, so
      nothing is downloaded to a local filesystem and a large file does not have
      to pass through the conversation to be read.
  - q: Can it copy a folder in Drive?
    a: >-
      No. Google Drive refuses to copy a folder and answers with a 403 that reads
      like a permissions problem. It is not one, and retrying with wider access
      will not change it. Files copy fine, optionally into another folder.
  - q: Should I copy a template or ask the assistant to rebuild it?
    a: >-
      Copy it. Rebuilding a document from scratch gives you something that looks
      close and drifts a little each time, while a Drive copy carries the
      original's tabs, formatting and formulas exactly, because it is the same
      file. Copy first, then fill in the copy.
  - q: Does renaming a file in Drive change anything else about it?
    a: >-
      No. The Drive rename tool changes the name only, and the file's content,
      location and sharing are untouched. It works on Google Docs, Sheets, Slides
      and folders.
---

The Drive connector lets your AI assistant search across your Google Drive, read file contents, and organize files into folders.

Reading happens server-side: the text comes back in the response, so nothing is
downloaded to a local filesystem and a large file does not have to pass through
the conversation to be read.

## Available operations

| Tool | Description |
|------|-------------|
| `drive_search` | Search files using Drive query syntax, e.g. `name contains 'report'` or `mimeType='application/vnd.google-apps.spreadsheet'`. Returns names, IDs, types and modification dates. `page_size` defaults to 20 |
| `drive_read_file` | Read a file's text content by file ID. Handles Google Docs, Sheets and Slides, Office `.docx`/`.xlsx`/`.pptx` (converted automatically), and `.txt`/`.csv`. Returns the extracted text directly, with no local download |
| `drive_create_folder` | Create a new folder, optionally inside a parent folder |
| `drive_rename_file` | Rename a file or folder by ID. Changes the name only: content, location and sharing are untouched. Works on Docs, Sheets, Slides and folders |
| `drive_copy_file` | Copy a file and name the copy in the same call, optionally into another folder with `parent_id`. The copy carries the original's tabs, formatting and formulas. **Folders cannot be copied** |

## What `drive_read_file` can and cannot read

| Type | Read as |
|------|---------|
| Google Docs, Sheets, Slides | Extracted text, the same extraction the dedicated tools use |
| `.docx`, `.xlsx`, `.pptx` | Converted to the matching Google format in a temporary copy, read, and the copy deleted |
| `.txt`, `.csv` | Returned as-is |
| Anything else, **PDFs included** | An `Unsupported file type` error |

PDFs are the common surprise: the tool reads text out of documents, not out of
scanned or rendered pages.

## Required scopes

- `https://www.googleapis.com/auth/drive`

## Multiple accounts

Every tool on this page takes an optional `account` argument: the email address
of the connected Google account to act on. Omit it and the default account is
used. Connect a personal and a work account and your assistant can read from
one and write to the other in the same turn, without you switching profiles.

## Example prompts

- "Find the latest Q2 revenue deck in my Drive"
- "Read the contents of the onboarding checklist doc and summarize it"
- "Create a new folder called 'April Reports' inside my Reports folder"
- "Search Drive for all spreadsheets modified in the last week"

## Copying beats rebuilding

`drive_copy_file` exists mainly for templates. Asking Claude to rebuild a document from
scratch gives you something that looks close and drifts a little each time. Copying gives you
the original's tabs, formatting and formulas exactly, because it is the same file. Copy first,
then fill in the copy.

Drive refuses to copy a **folder**, answering with a 403 that reads like a permissions problem.
It is not one, and retrying with wider access will not change it.
