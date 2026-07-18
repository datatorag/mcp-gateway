---
title: "Docs"
description: "Read, create, write, and batch update Google Docs."
order: 4
section: "connectors"
connector: "google-workspace"
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
