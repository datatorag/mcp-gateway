---
title: "Docs"
searchTitle: "Google Docs MCP Server: Read and Edit Docs | DataToRAG"
description: "Let your agent read, create, and edit Google Docs, including documents that already exist, through the DataToRAG MCP server for Google Workspace."
order: 4
section: "connectors"
connector: "google-workspace"
faqs:
  - q: Can DataToRAG edit a Google Doc that already exists?
    a: >-
      Yes. The Docs tools insert text at the start of an existing document and
      apply batch updates to it, which is how text is replaced or placed
      anywhere else, alongside creating new documents and deleting
      them.
  - q: What is the Docs batch update for?
    a: >-
      Applying several changes in one request. The Google Docs batch update tool
      can insert text, add formatting and replace content in a single call rather
      than one call per change.
  - q: Does reading a Google Doc include its images?
    a: >-
      It includes inline image metadata. The Docs read tool returns a
      document's paragraph text with each inline image marked, along with
      metadata for those images, not the image files themselves. Text inside a
      table is left out in text and index mode; mode full returns the raw
      document, tables included.
  - q: Why does deleting a doc need Drive access?
    a: >-
      Because deleting a file is a Drive operation. The Docs connector uses
      the Google Docs scope for creating, reading and writing documents, plus
      the Google Drive scope specifically for deleting them.
---

The Docs connector gives your AI agent the ability to read and write Google Docs: creating documents, inserting content, and applying batch formatting updates.

## Available operations

| Tool | Description |
|------|-------------|
| `docs_get` | Read a Google Doc. `mode: "text"` (the default) returns plain text with inline images marked; `"index"` adds the character positions `docs_batch_update` takes; `"full"` returns the raw API response. Text and index mode read paragraph text only, so text inside a table is left out; `"full"` includes it. `start_index` and `end_index` read part of a long document, and the answer says where the next part starts |
| `docs_create` | Create a new, empty Google Doc with a title. Add content with `docs_write` or `docs_batch_update` |
| `docs_write` | Insert text at the beginning of a document. It does not replace what is there; to replace or to insert elsewhere, use `docs_batch_update` |
| `docs_batch_update` | Apply multiple updates in a single request (insert text, add formatting, replace content) |
| `docs_delete` | Delete a Google Doc. The delete is permanent, not a move to the trash |

## Required scopes

- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/drive` (for delete, which is a Drive operation)

## Multiple accounts

Every tool on this page takes an optional `account` argument: the email address
of the connected Google account to act on. Omit it and the default account is
used. Connect a personal and a work account and your agent can read from
one and write to the other in the same turn, without you switching profiles.

## Example prompts

- "Read the product spec doc and list all the open questions"
- "Create a new doc called 'Weekly Standup Notes' and write today's agenda"
- "Summarize the meeting notes from last Tuesday's doc and append action items at the bottom"
- "Find the onboarding doc in Drive and update the section on tooling setup"
