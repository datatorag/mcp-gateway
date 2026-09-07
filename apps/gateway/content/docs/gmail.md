---
title: "Gmail"
description: "Search, read, send, reply, forward, and draft emails, and manage labels."
order: 1
section: "connectors"
connector: "google-workspace"
faqs:
  - q: Can DataToRAG send and reply to email, or only read it?
    a: >-
      It sends. The Gmail tools cover sending a new message, replying to an
      existing thread and forwarding a message, alongside creating, updating,
      sending and deleting drafts. Searching and reading use Gmail's own query
      syntax.
  - q: How does DataToRAG archive an email?
    a: >-
      By removing the INBOX label. The Gmail label tool adds or removes labels on
      one message or several, and removing INBOX archives a message while
      removing UNREAD marks it read.
  - q: Can it mark a lot of messages read at once?
    a: >-
      Yes. The Gmail mark-read tool takes a single message or a batch of up to
      1,000 message IDs. For label changes beyond read state, DataToRAG uses the
      label tool instead.
  - q: If I delete a Gmail label, do the messages go too?
    a: >-
      No. Deleting a label removes it from every message carrying it, and the
      messages themselves are not deleted. Gmail's system labels, including
      INBOX, UNREAD and SENT, cannot be deleted at all.
  - q: Can it save an email attachment to Drive?
    a: >-
      Yes. One Gmail tool saves an email attachment straight to Google Drive, and
      DataToRAG's search tool can find the messages carrying attachments first
      using Gmail's own query syntax.
  - q: What Gmail permission does DataToRAG ask for?
    a: >-
      One scope, gmail.modify. That single Google scope covers everything the
      Gmail connector does: searching, reading, sending, replying, forwarding,
      drafting, saving attachments to Drive and managing labels.
---

The Gmail connector gives your AI assistant full access to your inbox: searching, reading, composing, labeling, and organizing messages.

![A gmail_send call with its to, subject and body arguments, and the message id, thread id and SENT label it returned](/docs/gmail-send.png)

## Available operations

| Tool | Description |
|------|-------------|
| `gmail_search` | Search emails using Gmail query syntax (e.g., `from:boss subject:Q2 has:attachment`). Results include flattened from/to/subject/date plus snippet and labels |
| `gmail_list` | List recent messages from your inbox with flattened from/to/subject/date fields |
| `gmail_read` | Read a full email by message ID. `text_only` returns a compact view (flattened headers, decoded text body, attachment metadata); `max_body_chars` truncates long bodies |
| `gmail_send` | Send a new email. Your Gmail signature is added; `signature: false` sends without it |
| `gmail_reply` | Reply to an existing thread. Your Gmail signature goes under your note, above the quoted message |
| `gmail_forward` | Forward a message to another recipient, signed the same way as a reply |
| `gmail_create_draft` | Create a draft without sending. Drafts are never signed |
| `gmail_update_draft` | Update an existing draft |
| `gmail_send_draft` | Send an existing draft. The signature is added at this point, once |
| `gmail_delete_draft` | Delete a draft |
| `gmail_mark_read` | Mark messages as read, for a single message or a batch of up to 1,000 IDs. For label changes beyond read state, use `gmail_label_message` |
| `gmail_label_message` | Label many messages in one call: `message_ids` (up to 1,000) with `add_labels` and `remove_labels`, one `batchModify` request, a per-message outcome in the result; `message_id` for a single message. Removing INBOX archives a message; removing UNREAD marks it read |
| `gmail_create_label` | Create a label. Nested labels use `/` in the name (e.g., `Alerts/Invoices`). Returns the created label, including its ID |
| `gmail_list_labels` | List every label, system and user-created, with its ID, name, and type. Label IDs feed `gmail_label_message`, `gmail_update_label`, and `gmail_delete_label` |
| `gmail_update_label` | Rename a label or change its visibility. Takes the label ID, not the name. Renaming keeps the label on already-labeled messages |
| `gmail_delete_label` | Delete a label by ID. The label is removed from every message carrying it; the messages themselves are not deleted. System labels (INBOX, UNREAD, SENT) cannot be deleted |
| `gmail_save_attachment_to_drive` | Save an email attachment directly to Google Drive |

## Signatures

Mail sent with `gmail_send`, `gmail_reply`, `gmail_forward` or `gmail_send_draft` ends with the signature set in Gmail for the address it is sent from. Nothing needs configuring, and an alias uses its own signature.

- On a new message the signature closes the body. On a reply or forward it sits under your note and above the quoted message.
- `gmail_create_draft` and `gmail_update_draft` never sign. A draft is signed once, when `gmail_send_draft` sends it.
- Pass `signature: false` to send a message exactly as written.
- Messages go out with a plain-text and an HTML version. The signature is in the HTML version only.

Every send response carries a `signature` field:

| Value | Meaning |
|-------|---------|
| `applied` | The signature was added |
| `none_set` | The account has no signature in Gmail |
| `suppressed` | You passed `signature: false` |
| `already_present` | The body already ended with the signature, so it was not added again |
| `unavailable` | The signature could not be read; the message was sent unsigned |
| `skipped_unsupported_draft` | The draft's format is one we send untouched rather than rewrite |

Gmail's mobile apps fold a signature they recognise behind the three-dot button. The signature is still in the message.

## Required scopes

- `https://www.googleapis.com/auth/gmail.modify`

## Example prompts

- "Search my inbox for emails from @acme.com in the last week and summarize the key asks"
- "Draft a reply to the latest email from Sarah declining the meeting politely"
- "Find all unread emails with attachments and save the attachments to my Reports folder in Drive"
- "Forward the Q2 report email to the marketing team with a note"
- "Draft replies to every unanswered client email from this week, then send the drafts I approve"
- "Create an Alerts/Invoices label, apply it to every email from our billing provider this month, and archive them"
