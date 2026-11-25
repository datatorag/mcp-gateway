---
title: "Drive"
searchTitle: "Google Drive MCP Server: Search and Read Files | DataToRAG"
description: "Google Drive tools in the DataToRAG MCP server: search and read files, upload, copy, move, rename, trash, and share them, and create folders."
order: 3
section: "connectors"
connector: "google-workspace"
faqs:
  - q: Can DataToRAG read a PDF from Drive?
    a: >-
      Not directly. The Drive read tool answers a PDF with an Unsupported file
      type error. To read one, copy it with the Drive copy tool and a target type
      of Google Doc: Drive recognizes the text, and the copy reads like any other
      Doc. The original PDF is left as it was.
  - q: Which file types can the Drive reader handle?
    a: >-
      Three kinds. Google Docs, Sheets and Slides come back as extracted text,
      using the same extraction the dedicated tools use; .docx, .xlsx and .pptx,
      and the older .doc, .xls and .ppt,
      are converted to the matching Google format in a temporary copy that is
      read and then deleted; .txt and .csv are returned as they are. Anything
      else, PDFs included, returns an Unsupported file type error. A Sheet read
      through the Drive reader is its first tab, up to column Z and row 1000;
      the Sheets tools read the rest.
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
  - q: Should I copy a template or ask the agent to rebuild it?
    a: >-
      Copy it. Rebuilding a document from scratch gives you something that looks
      close and drifts a little each time, while a Drive copy carries the
      original's tabs, formatting and formulas exactly, because it is the same
      file. Copy first, then fill in the copy.
  - q: Does renaming a file in Drive change anything else about it?
    a: >-
      No. The Drive rename tool changes the name only, and the file's content,
      location and sharing are untouched. It works on any file or folder the
      account can edit.
---

DataToRAG is an MCP server whose Google Drive tools let an agent search across your Drive, read file contents, and organize files into folders.

Reading happens server-side: the text comes back in the response, so nothing is
downloaded to a local filesystem and a large file does not have to pass through
the conversation to be read.

## Google Drive tools

| Tool | Description |
|------|-------------|
| `drive_search` | Search files using Drive query syntax, e.g. `name contains 'report'` or `mimeType='application/vnd.google-apps.spreadsheet'`. Returns names, IDs, types and modification dates. `page_size` defaults to 20 |
| `drive_read_file` | Read a file's text content by file ID. Handles Google Docs, Sheets and Slides, Office `.docx`/`.xlsx`/`.pptx` and the older `.doc`/`.xls`/`.ppt` (converted automatically), and `.txt`/`.csv`. Returns the extracted text directly, with no local download |
| `drive_create_folder` | Create a new folder, optionally inside a parent folder |
| `drive_rename_file` | Rename a file or folder by ID. Changes the name only: content, location and sharing are untouched. Works on any file or folder the account can edit |
| `drive_upload_file` | Put a file into Drive, named by a [file reference](/docs/file-references): an email, one of its attachments, a file from another connected account's Drive (as stored, or a Google file exported, such as a Doc as a PDF), a file your agent already holds (up to 1 MB), or a file you send from your computer through an upload link (up to 25 MB). The receipt includes the SHA-256 Drive reports for what it stored and whether it matches what was sent, and the owners and sharing of the folder it went into |
| `drive_copy_file` | Copy a file and name the copy in the same call, optionally into another folder with `parent_id`. The copy carries the original's tabs, formatting and formulas. With `convert: true`, an Excel, Word or PowerPoint file is copied as a Google Sheet, Doc or Slides file. With `target_mime_type`, the copy is converted to the Google type named, so a PDF or an image becomes a Google Doc with its text recognized, in the language `ocr_language` names when given. **Folders cannot be copied** |
| `drive_get_file` | Describe a file or folder by ID without reading its content: name, type, size, the folders it is in, owners, created and modified times, link, and whether it is in Trash |
| `drive_move_file` | Move a file or folder into another folder. It is removed from the folder it was in, so it ends up in one place; name, content and ID are unchanged |
| `drive_trash_file` | Move a file or folder to Trash, where its owner can restore it for 30 days. Trashing a folder trashes what is inside it |
| `drive_share_file` | Share a file or folder with one person by email, as reader, commenter or writer. Google emails them unless `notify` is false, with your `message` if you give one. The answer lists who has access afterwards |
| `drive_get_file_permissions` | List who has access to a file or folder: each person, group, domain or link, with their role |
| `drive_list_recent_files` | The files you opened most recently, or with `by: "modified"` the most recently changed, with name, type, time and link. `page_size` defaults to 20 |

## What `drive_read_file` can and cannot read

| Type | Read as |
|------|---------|
| Google Docs, Sheets, Slides | Extracted text, the same extraction the dedicated tools use. A Sheet comes back as its first tab only, up to column Z and row 1000; use `sheets_read` for another tab or a larger range |
| `.docx`, `.xlsx`, `.pptx`, and the older `.doc`, `.xls`, `.ppt` | Converted to the matching Google format in a temporary copy, read, and the copy deleted |
| `.txt`, `.csv` | Returned as-is |
| Anything else, **PDFs included** | An `Unsupported file type` error |

PDFs are the common surprise: the tool reads text out of documents, not out of
scanned or rendered pages. To read a PDF or an image, copy it with
`drive_copy_file` and `target_mime_type: "application/vnd.google-apps.document"`.
Drive recognizes the text, and the copy is a Google Doc the tools can read.

## Downloading a file from Google Drive

`drive_read_file` returns text. To get the file itself, name it with a [file reference](/docs/file-references):

- `{"type": "drive_file", "file_id": "<file id>"}` is a Drive file as stored, such as a PDF or an image.
- `{"type": "drive_export", "file_id": "<file id>", "format": "pdf"}` is a Google Doc, Sheet, or Slides file exported to a format. These have no stored file, so they need `drive_export`.

`file_download_link` takes either reference and answers with the file's name, size, and SHA-256, and a link that saves the file to your computer. The link works once and lasts ten minutes. `jira_add_attachment` and `notion_attach_file` take the same references, to put a Drive file on a Jira issue or a Notion page. In each case the file's content never enters the conversation. One file per call, at most 25 MB, or 20 MB for Notion.

## Scopes the Google Drive tools need

- `https://www.googleapis.com/auth/drive`

## Using Google Drive on more than one account

Every tool on this page takes an optional `account` argument: the email address
of the connected Google account to act on. Omit it and the default account is
used. Connect a personal and a work account and your agent can read from
one and write to the other in the same turn, without you switching profiles.

## Example prompts for Google Drive

- "Find the latest Q2 revenue deck in my Drive"
- "Read the contents of the onboarding checklist doc and summarize it"
- "Create a new folder called 'April Reports' inside my Reports folder"
- "Search Drive for all spreadsheets modified in the last week"

## Copy a template instead of rebuilding it

`drive_copy_file` exists mainly for templates. Asking your agent to rebuild a document from
scratch gives you something that looks close and drifts a little each time. Copying gives you
the original's tabs, formatting and formulas exactly, because it is the same file. Copy first,
then fill in the copy.

Drive refuses to copy a **folder**, answering with a 403 that reads like a permissions problem.
It is not one, and retrying with wider access will not change it.

## Working with Excel, Word, and PowerPoint files in Drive

An `.xlsx` stored in Drive opens in the browser like a spreadsheet, but it is still an Excel
file, and the Sheets tools cannot open it. The same goes for `.docx` with the Docs tools and
`.pptx` with the Slides tools. When that happens the tool says so, and names the fix:
`drive_copy_file` with `convert: true` makes a Google Sheet, Doc or Slides copy, and the tools
work on that copy. The original stays as it was. `.xls`, `.doc` and `.ppt` convert the same way.

`drive_read_file` does not need this: it converts a temporary copy on its own, reads it, and
deletes it.
