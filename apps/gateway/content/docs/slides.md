---
title: "Slides"
searchTitle: "Google Slides MCP Server: Read and Edit Decks | DataToRAG"
description: "Let your agent read, create, batch update, and delete Google Slides presentations through the DataToRAG MCP server for Google Workspace."
order: 6
section: "connectors"
connector: "google-workspace"
faqs:
  - q: Can DataToRAG add text to a slide that already exists?
    a: >-
      Yes. The Slides batch update tool inserts or replaces text, adds slides and
      deletes objects, in the Google Slides batchUpdate format, applied in order
      in one call. Reading the deck first returns the slide object IDs to target.
  - q: How does it know where to put text on a deck it just created?
    a: >-
      From the placeholder map. Creating a presentation returns its ID plus a
      placeholder map per slide, pairing TITLE, BODY and SUBTITLE with their
      object IDs, so the first text insertion needs no lookup.
  - q: Will reading a large presentation use up my context window?
    a: >-
      Less than you would expect. The Slides read tool returns slide object IDs,
      placeholder types and their text, stripped of layout and styling data, so a
      large deck still fits in context.
  - q: Can Slides tools target a specific Google account?
    a: >-
      Yes. Every tool on this page takes an optional account argument naming the
      connected Google account to act on, and omitting it uses the default
      account. With a personal and a work account connected, your agent can
      read from one and write to the other in the same turn.
---

DataToRAG is an MCP server whose Google Slides tools let an agent read presentation content, create new decks, and apply batch updates to slides.

![A slides_batch_update call inserting text into an existing slide's body placeholder, with the revision id it returned](/docs/slides-batch-update.png)

## Google Slides tools

| Tool | Description |
|------|-------------|
| `slides_get` | Read a presentation's content: slide `objectId`s, placeholder types (TITLE/BODY/SUBTITLE) and text, stripped of layout and styling data so a large deck still fits in context. Feed the returned `objectId`s to `slides_batch_update` |
| `slides_create` | Create a presentation. Returns the `presentationId` and a `placeholder_map` per slide, mapping TITLE/BODY/SUBTITLE to their `objectId`s, so the first `insertText` needs no lookup |
| `slides_batch_update` | Insert or replace text, add slides, delete objects and other edits, in the Google Slides API `batchUpdate` format. One call, applied in order |
| `slides_delete` | Delete a presentation. The delete is permanent, not a move to the trash; use `drive_trash_file` for one you may want back |

## Scopes the Google Slides tools need

- `https://www.googleapis.com/auth/presentations`
- `https://www.googleapis.com/auth/drive` (for delete, which is a Drive operation)

## Using Google Slides on more than one account

Every tool on this page takes an optional `account` argument: the email address
of the connected Google account to act on. Omit it and the default account is
used. Connect a personal and a work account and your agent can read from
one and write to the other in the same turn, without you switching profiles.

## Example prompts for Google Slides

- "Read my Q2 sales deck and summarize the key points from each slide"
- "Create a new presentation called 'Team Update' with a title slide"
- "Find the latest investor deck in Drive and update the revenue numbers on slide 3"
- "Add a new slide at the end of the product roadmap deck with this quarter's milestones"
