---
title: "We Said Claude Couldn't Send Email. It Can Now."
excerpt: "This post used to argue that Claude's native Gmail connector drafts but never sends. As of August 24, 2026 that is wrong: it sends, replies, and forwards. Here is the corrected comparison, and what is left for us."
searchTitle: "Claude Gmail Connector vs DataToRAG: Send, Reply, Labels"
searchDescription: "A dated comparison of Claude's built-in Gmail connector and DataToRAG's Gmail tools: sending, replying, labels, and what DataToRAG adds across accounts."
date: "2026-04-21"
updated: "2026-11-25"
updatedNote: "November 25, 2026: re-read against Anthropic's help page. The attachments row and paragraph said the native connector could only hand an attachment back through the conversation; the page says Claude opens attachments up to about 12 MB and uploads files to Drive, so that difference is narrowed. The multi-account row and paragraph said the native connector takes one Google account and makes you reconnect to switch; the page does not say how many accounts you can connect, so the row now says so and the reconnect sentence is removed. The section on Sheets, Slides, Docs, Contacts, and Tasks is dated: the page lists Docs, Sheets, and Slides connectors that create and edit files, with no beta label. October 19, 2026: two rows flip in our favor. We now label or unlabel a whole thread in one call, trash and untrash a whole thread, and mark and unmark spam, so 'Label or archive a whole thread in one call' and 'Trash, untrash, mark spam' read Yes for us as well. Earlier, October 15, later the same day: the Docs and Sheets lines and the closing line are corrected, and the Slides line carries its October 9 date. Claude's Google Docs connector, in beta since October 2026 and enumerated on 15 October 2026, edits an existing doc in place, and its Sheets connector edits cells and tabs. Earlier on October 15: the Docs line under 'what is left' now says 'as of our last check' and points to the dated note on the Drive post: Anthropic announced Docs, Sheets and Slides editing connectors on 6 October 2026, and they had not reached our account by 15 October. Fourth correction, October 9, in the same direction as the others: the native connector does delete a draft. It has a delete_draft tool, so the 'Delete a draft' row now reads Yes for both and the paragraph that said it had no way to remove one is rewritten. The trash row said Partial for us and now says No: we have no tool that trashes a message. The Docs line under 'what is left' said the native connector only reads; it also creates a new doc, and what it cannot do is edit one. Still standing from the MAJOR CORRECTION of August 24: the central claim of this post is no longer true. Claude's native Gmail connector now exposes send_message (including sending an existing draft), reply with reply-all, and forward. The original title was 'Claude Can Draft Your Email. It Can't Send It.' We have rewritten the post rather than retitling around the edges, because the gap it was built on has closed. Earlier corrections on August 7 and August 11 covered labelling and thread-level filing."
author: "Manuel Yang"
category: "Comparison"
coverImage: "/blog/gmail-comparison.png"
tags: ["gmail", "claude", "mcp", "comparison", "google-workspace"]
related: ["claude-google-workspace-mcp-alternatives", "claude-google-calendar-vs-datatorag-multi-account", "claude-google-drive-vs-datatorag-editing", "the-gaps-in-the-table-were-ours"]
---

**Short answer, as of August 24, 2026:** Claude's native Gmail connector sends email. It also
replies, replies-all, and forwards. For four months this post said the opposite, and it was
right when we wrote it. It is wrong now, so here is the correction and the honest current
picture.

We could have quietly edited a few sentences. We are not going to, because the whole argument
of this post was one capability gap, and that gap is gone. A comparison post that survives the
thing it compares is not a comparison, it is an advertisement.

## What actually changed

When this went up in April, the native connector's tool surface ended at drafts.
`create_draft`, `update_draft`, `list_drafts`, and nothing after it. No send, no reply, no
forward. We re-checked on August 7 and again on August 11 and it still read that way both times.

On August 24 we enumerated it again and it reads:

- `send_message`, which sends a new message **and** sends an existing draft when you pass it a
  `draftId`
- `reply`, with a `replyAll` flag
- `forward`, with an optional comment
- plus trash, untrash, spam, unspam, and the sensitive-label tools

So the exact sentence this post was named after, "it has no tool to send that draft", is now
false. Anthropic shipped the verbs. That is a real improvement and it closes the most
frequently cited limitation of the native connector.

## The corrected comparison

| Capability | Claude native Gmail | DataToRAG Gmail |
|---|---|---|
| Search and read messages | Yes | Yes |
| Create a draft | Yes | Yes |
| **Send a new message** | **Yes** | Yes |
| **Send an existing draft** | **Yes**, via `send_message` with a draft id | Yes, `gmail_send_draft` |
| **Reply within a thread** | **Yes**, including reply-all | Yes |
| **Forward a message** | **Yes** | Yes |
| Delete a draft | Yes | Yes |
| Mark messages read or unread | Yes | Yes |
| Label or archive individual messages | Yes | Yes |
| Label or archive a whole thread in one call | Yes | Yes |
| Trash, untrash, mark spam | Yes | Yes |
| Open an email attachment | Yes, up to about 12 MB (November 25, 2026) | Yes |
| Save an attachment to Drive in one call, without the file entering the conversation | Not described on Anthropic's help page (November 25, 2026) | Yes, `gmail_save_attachment_to_drive` |
| Several Google accounts in one request | Not described on Anthropic's help page (November 25, 2026) | Yes |

Both columns are what each connector exposes as tools, enumerated on August 24, 2026. Rows
move. The date is there so you can tell how stale this table is when you find it. It moved
again on October 9, 2026: the "Delete a draft" row said No for the native connector until
then. And on October 19, 2026 the thread and spam rows changed on our side, when we shipped
thread-level labels, thread trash and spam. The last three rows were rewritten on November 25,
2026 from [Anthropic's help page](https://support.claude.com/en/articles/10166901-use-google-workspace-connectors);
"not described" means the page does not say either way.

## What is left, stated without inflation

Less than there was. It was three rows until October 9, 2026, two until November 25, 2026, and
it is now one narrow difference and one that matters.

**Deleting a draft, which used to be on this list.** This section said the native connector
had no way to remove a draft it created. It does: it has a `delete_draft` tool, found when we
re-enumerated it on October 9, 2026. Both connectors delete drafts, and this is no longer a
gap in either direction.

**Attachments.** Ours saves an attachment straight to Drive on the server with
`gmail_save_attachment_to_drive`, so the file never enters the conversation. This paragraph
used to say the native connector could only hand an attachment back through the context
window. As of November 25, 2026, Anthropic's help page says Claude can open an email
attachment to read or work with the file, up to about 12 MB, and that the Drive connector
uploads any file type. So this is a narrow difference now: one call on our side, and no
12 MB ceiling.

**Multi-account, which is the one that actually matters.** Ours holds several Google accounts
at once and routes per call, so "check both inboxes and reply from the right one" is a single
prompt. Anthropic's help page, as of November 25, 2026, does not describe connecting more than
one: it says Claude can only access the data "for the Google account you've connected." This
paragraph used to say you had to disconnect and reconnect to switch accounts. The page does not
say that, so the sentence is gone.

That is the current Gmail story. One meaningful differentiator, one small one. If Gmail alone
is your use case and one account covers it, **use the native connector.** It comes with Claude, it is
first-party, and it now finishes the job.

## Where the gap is still wide

**As of November 25, 2026, most of this gap has closed too.** [Anthropic's help page](https://support.claude.com/en/articles/10166901-use-google-workspace-connectors)
lists separate Docs, Sheets, and Slides connectors that create and edit files, with no beta
label, on Claude and Claude Desktop. The list below is kept as the record of what we found and
when, with today's status beside each line.

Gmail is no longer where we win, and it would be dishonest to keep implying it is. Through
2026 the gap moved to the other services, and then narrowed there as well:

- **Sheets.** In October 2026 Claude's own Sheets connector arrived, in beta at the time, and
  edited cells, appended, and managed tabs (enumerated October 15, 2026). Ours also runs a
  query over a sheet with `sheets_query`. Anthropic's page does not say whether theirs does.
- **Slides.** On October 9, 2026, native Drive created an empty deck, and nothing native wrote
  content onto slides. As of November 25, 2026, Anthropic's page says Claude creates and edits
  Slides files, and that it cannot add charts to them.
- **Docs.** Since October 2026 Claude's own Docs connector edits a doc in place (enumerated
  October 15, 2026); see the [Drive post](/blog/claude-google-drive-vs-datatorag-editing). Ours
  creates, writes, and batch-updates.
- **Contacts and Tasks.** Anthropic's page lists Gmail, Calendar, Drive, Docs, Sheets, and
  Slides connectors, and names none for Contacts or Tasks, as of November 25, 2026. Ours has
  both.

If your workflow crosses accounts or services, that is the comparison worth reading, not
this one.

## The part we want to keep from the original post

This post already contained the method that caught it, which is why we are keeping the section.

We originally blamed a missing `gmail.modify` scope for the send gap, and
[the bug report we cited](https://github.com/anthropics/claude-code/issues/46206) said the same.
That was wrong reasoning even when the conclusion was right. A scope is invisible from the
outside, inferred rather than observed, and it moves without an announcement. That same report
listed "manage drafts and send emails" among the granted scopes, on a connector that at the
time had no send tool. **Scope and capability come apart in both directions, and neither
predicts the other.**

So we stopped reasoning from scopes and started enumerating tools, and writing down the date we
checked. That is the only reason this correction took thirteen days instead of six months. The
method worked. We just have to keep running it.

## What we would tell you to do

Connect the native Gmail connector first. It comes with Claude and for a lot of people it is
now enough.

Come to [DataToRAG](https://datatorag.com/dashboard) for what we add: several Google accounts
in one request, an email's attachment sent on to a Jira issue or a Notion page, and the same
tools in Cursor or an app of your own.

Our Gmail tools are listed in the [Gmail docs](/docs/gmail). The tools we added on October 19, 2026 are in [the gaps in the table were ours](/blog/the-gaps-in-the-table-were-ours), the companion comparisons cover [Calendar](/blog/claude-google-calendar-vs-datatorag-multi-account) and [Drive, Docs, and Sheets](/blog/claude-google-drive-vs-datatorag-editing), and [every way to connect Claude to Google Workspace](/blog/claude-google-workspace-mcp-alternatives) is the overview.
