---
title: "Docs"
description: "Read, create, write, and batch update Google Docs."
order: 4
section: "connectors"
connector: "google-workspace"
faqs:
  - q: Can DataToRAG edit a Google Doc that already exists?
    a: >-
      Yes. The Docs tools write or replace content in an existing document and
      apply batch updates to it, alongside creating new documents and deleting
      them.
  - q: What is the Docs batch update for?
    a: >-
      Applying several changes in one request. The Google Docs batch update tool
      can insert text, add formatting and replace content in a single call rather
      than one call per change.
  - q: Does reading a Google Doc include its images?
    a: >-
      It includes inline image metadata. The Docs read tool returns the full
      content of a document along with metadata for its inline images, rather
      than the image files themselves.
  - q: Why does creating or deleting a doc need Drive access?
    a: >-
      Because creating and deleting are Drive operations. The Docs connector uses
      the Google Docs scope for reading and writing content, plus the Google
      Drive scope specifically for creating and deleting documents.
---

The Docs connector gives your AI assistant the ability to read and write Google Docs — creating documents, inserting content, and applying batch formatting updates.

## Available operations

| Tool | Description |
|------|-------------|
| `docs_get` | Read the full content of a Google Doc, including inline image metadata |
| `docs_create` | Create a new Google Doc with a title and optional initial content |
| `docs_write` | Write or replace content in a document |
| `docs_batch_update` | Apply multiple updates in a single request (insert text, add formatting, replace content) |
| `docs_delete` | Delete a Google Doc |

## Required scopes

- `https://www.googleapis.com/auth/documents`
- `https://www.googleapis.com/auth/drive` (for create/delete)

## Example prompts

- "Read the product spec doc and list all the open questions"
- "Create a new doc called 'Weekly Standup Notes' and write today's agenda"
- "Summarize the meeting notes from last Tuesday's doc and append action items at the bottom"
- "Find the onboarding doc in Drive and update the section on tooling setup"
