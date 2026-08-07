---
title: "Claude Can Draft Your Email. It Can't Send It."
excerpt: "The native Claude Gmail connector writes drafts into your Drafts folder and stops there. It has no tool to send one, and none to delete one either. DataToRAG ships the verbs that finish the job."
date: "2026-04-21"
updated: "2026-08-07"
updatedNote: "Anthropic's Gmail connector has since gained labelling, marking read, and archiving, so the labels section and the comparison table are rewritten. The send gap is unchanged: it still creates drafts it can neither send nor delete."
author: "Manuel Yang"
category: "Comparison"
coverImage: "/blog/gmail-comparison.png"
tags: ["gmail", "claude", "mcp", "comparison", "google-workspace"]
---

Every time I've watched someone use Claude with their Gmail, the same moment happens. They ask Claude to write a reply. Claude writes a good reply. They squint at the screen and then say, "okay, how do I… send this?" And the answer is: you can't. Claude put the draft in your Drafts folder. You have to open Gmail, click into Drafts, click Send.

That's not a bug. It's the design intent of Claude's native Gmail connector. The connector reads your inbox and drafts messages into Drafts, and it will not send anything. Ask it to list its own tools and the shape is obvious: `create_draft`, `update_draft`, `list_drafts`, and then the trail ends. No send. No send-draft. No reply. No forward. Not even a delete, so the draft it just wrote for you is one it can neither send nor throw away. We re-enumerated that tool surface on August 7, 2026 and it still reads the same way.

The design goal is safety: you review every outbound action. The result is that every email workflow ends with Claude handing you a sticky note saying "the draft is waiting in Gmail."

## Feature comparison

| Capability | Claude native Gmail | DataToRAG Gmail |
|---|---|---|
| Search and read messages | Yes | Yes |
| Create a draft in Drafts folder | Yes | Yes |
| Send that draft | No | Yes |
| Delete that draft | No | Yes |
| Send a new message | No | Yes |
| Reply within a thread | No | Yes |
| Forward a message | No | Yes |
| Mark messages read or unread | Yes | Yes |
| Label or archive threads | Yes | Yes |
| Save attachment to Drive server-side | No | Yes |
| Multi-account (work + personal Gmail) | No | Yes |

The native column is what its connector exposes as tools, enumerated on August 7, 2026. Rows move; the date is there so you can tell how stale this table is when you find it.

## What DataToRAG's Gmail connector adds

DataToRAG ships the full set of Gmail verbs:

- `gmail_send`: compose and deliver a new message.
- `gmail_reply`: reply within a thread, keeping the subject and thread context intact.
- `gmail_forward`: forward a message with an optional note.
- `gmail_create_draft`, `gmail_update_draft`, `gmail_send_draft`, `gmail_delete_draft`: when you do want the review gate, including the two verbs that end it.
- `gmail_mark_read`: close inbox items after acting on them.
- `gmail_save_attachment_to_drive`: move attachments server-side so the binary doesn't touch your conversation context.

The LLM already requires your approval before calling a tool. Making the tool not actually do the thing isn't an extra layer of safety; it's extra friction for the same outcome.

## What Claude's Gmail connector is genuinely good at

Reading, searching, and filing. If you ask "what did my director email me about last week," Claude's Gmail connector finds the thread, cites it, and summarizes it, and it can now file that thread under a label when it's done. Nothing wrong with any of that. The limitation isn't "Claude can't see Gmail." It's "Claude can't finish the workflow."

## Where the gap bites

Consider a common customer-support loop: read incoming customer emails, draft replies, send them. With the Gmail connector that looks like this: Claude reads (fine), Claude drafts (fine), you open Gmail, you click into Drafts one by one, you click Send on each. Claude did the hard part (drafting) and you did the repetitive part (the clicking).

With DataToRAG: Claude reads, drafts, sends. Same conversation. One approval per message if you want checkpoints, or an approved-by-default workflow if you trust it.

## Labels used to be the second gap

When this post went up in April, "label these threads 'needs-follow-up' and archive the rest" was a prompt the native connector could not finish. That has changed, and it's worth saying so in the post rather than quietly deleting the sentence.

We enumerated the connector's tools again on August 7, 2026 and counted seven for labels alone: create, update and delete a label, then add or remove one on a message or on a whole thread. Two more handle the sensitive ones, Trash and Spam. And because Gmail models read state and archiving as labels rather than as separate concepts, the same tools cover more than filing: removing `UNREAD` marks a message read, removing `INBOX` archives it, adding `STARRED` stars it. So the native connector labels, stars, marks read, archives and trashes. Anthropic shipped that, and it's a real improvement.

Here's the part we got wrong even while the conclusion held. We had blamed a missing `gmail.modify` scope, and [the bug report we cited](https://github.com/anthropics/claude-code/issues/46206) said the same. But a scope is invisible from the outside, inferred rather than observed, and it moves without an announcement. Worse, that same report lists "manage drafts and send emails" among the scopes the connector was granted, on a connector that has never exposed a send tool. Scope and capability come apart in both directions, and neither one predicts the other.

The tool list is the thing you can actually enumerate, and it's what a prompt actually hits. So that's what we check now, and we write down the date we checked it.

## The minute that should exist

Try this prompt on your setup: "Read the last five emails from our biggest customer and reply to each with a short acknowledgement."

On the Gmail connector, Claude drafts five emails and leaves them in Drafts. You spend the next three minutes clicking through Gmail sending them.

On DataToRAG, the replies are sent before you finish reading Claude's confirmation message.

## Try it

Connect your Google account at [datatorag.com/dashboard](https://datatorag.com/dashboard). The switch is worth two minutes.
