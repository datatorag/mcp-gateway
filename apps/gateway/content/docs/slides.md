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
| `slides_get` | Read the content and structure of a presentation |
| `slides_create` | Create a new presentation |
| `slides_batch_update` | Apply multiple updates — add slides, insert text, replace content, modify layout |
| `slides_delete` | Delete a presentation |

## Required scopes

- `https://www.googleapis.com/auth/presentations`
- `https://www.googleapis.com/auth/drive` (for create/delete)

## Example prompts

- "Read my Q2 sales deck and summarize the key points from each slide"
- "Create a new presentation called 'Team Update' with a title slide"
- "Find the latest investor deck in Drive and update the revenue numbers on slide 3"
- "Add a new slide at the end of the product roadmap deck with this quarter's milestones"
