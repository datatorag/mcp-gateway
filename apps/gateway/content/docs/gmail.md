---
title: "Gmail"
description: "Search, read, send, reply, forward, and draft emails."
order: 1
section: "connectors"
connector: "google-workspace"
---

The Gmail connector gives your AI assistant full access to your inbox — searching, reading, composing, and organizing messages.

## Available operations

| Tool | Description |
|------|-------------|
| `gmail_search` | Search emails using Gmail query syntax (e.g., `from:boss subject:Q2 has:attachment`). Results include flattened from/to/subject/date plus snippet and labels |
| `gmail_list` | List recent messages from your inbox with flattened from/to/subject/date fields |
| `gmail_read` | Read a full email by message ID. `text_only` returns a compact view (flattened headers, decoded text body, attachment metadata); `max_body_chars` truncates long bodies |
| `gmail_send` | Send a new email |
| `gmail_reply` | Reply to an existing thread |
| `gmail_forward` | Forward a message to another recipient |
| `gmail_create_draft` | Create a draft without sending |
| `gmail_update_draft` | Update an existing draft |
| `gmail_send_draft` | Send an existing draft |
| `gmail_delete_draft` | Delete a draft |
| `gmail_mark_read` | Mark messages as read and modify labels, for a single message or a batch of up to 1,000 IDs |
| `gmail_save_attachment_to_drive` | Save an email attachment directly to Google Drive |

## Required scopes

- `https://www.googleapis.com/auth/gmail.modify`

## Example prompts

- "Search my inbox for emails from @acme.com in the last week and summarize the key asks"
- "Draft a reply to the latest email from Sarah declining the meeting politely"
- "Find all unread emails with attachments and save the attachments to my Reports folder in Drive"
- "Forward the Q2 report email to the marketing team with a note"
- "Draft replies to every unanswered client email from this week, then send the drafts I approve"
