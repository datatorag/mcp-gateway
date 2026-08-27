---
title: "Slides"
description: "Read, create, and update Google Slides presentations."
order: 6
section: "connectors"
connector: "google-workspace"
---

The Slides connector lets your AI assistant read presentation content, create new decks, and apply batch updates to slides.

![A slides_batch_update call inserting text into an existing slide's body placeholder, with the revision id it returned](/docs/slides-batch-update.png)

## Available operations

| Tool | Description |
|------|-------------|
| `slides_get` | Read a presentation's content: slide `objectId`s, placeholder types (TITLE/BODY/SUBTITLE) and text, stripped of layout and styling data so a large deck still fits in context. Feed the returned `objectId`s to `slides_batch_update` |
| `slides_create` | Create a presentation. Returns the `presentationId` and a `placeholder_map` per slide, mapping TITLE/BODY/SUBTITLE to their `objectId`s, so the first `insertText` needs no lookup |
| `slides_batch_update` | Insert or replace text, add slides, delete objects and other edits, in the Google Slides API `batchUpdate` format. One call, applied in order |
| `slides_delete` | Delete a presentation |

## Required scopes

- `https://www.googleapis.com/auth/presentations`
- `https://www.googleapis.com/auth/drive` (for create/delete)

## Multiple accounts

Every tool on this page takes an optional `account` argument: the email address
of the connected Google account to act on. Omit it and the default account is
used. Connect a personal and a work account and your assistant can read from
one and write to the other in the same turn, without you switching profiles.

## Example prompts

- "Read my Q2 sales deck and summarize the key points from each slide"
- "Create a new presentation called 'Team Update' with a title slide"
- "Find the latest investor deck in Drive and update the revenue numbers on slide 3"
- "Add a new slide at the end of the product roadmap deck with this quarter's milestones"
