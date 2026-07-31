---
title: "Triage your Gmail inbox with Claude"
order: 1
situation: "My inbox is full of things I don't need to read, and the two that matter are buried."
produces: "A short digest of what actually needs you, with everything else marked read."
tools: [gmail_search, gmail_read, gmail_mark_read]
accounts: multiple
---

# Inbox triage

Sorts a day of unread mail into things that need a human and things that don't, marks the
noise read, and hands back a digest with one-click links.

Read-only plus mark-as-read. It never sends, deletes, archives, or moves anything.

```markdown
---
name: inbox-triage
description: Triage unread inbox mail across accounts, mark noise read, produce a digest
---

# Inbox triage

Run this across every account you want triaged. Pass `account` explicitly on every call —
without it the connector uses your default, which is rarely the one you meant.

## Per account

1. Search unread inbox mail from the last day:
   `gmail_search` with query `is:unread in:inbox newer_than:1d`, max_results 25.

2. Classify each message from sender, subject and snippet. Prefer snippets. Use `gmail_read`
   only when a snippet is too thin to judge — full payloads are large, and if you are unsure
   it is better to leave the message unread and surface it than to read it and guess.

   - **IMPORTANT:** real humans, customers, invoices and payments, legal or government,
     banking, security alerts, anything needing a reply or an action.
   - **NOISE:** newsletters, promotions, product announcements, social notifications, CI and
     bot output, vendor event invites.

3. Mark only NOISE as read, via `gmail_mark_read`. **Never delete, archive, or remove the
   INBOX label.** When in doubt, leave it unread and put it in the digest.

## Then

4. Build a digest grouped by account: important items first, each with sender, subject, one
   line on why it matters, and a suggested action. Then a one-line marked-read count per
   account.

   Include a direct link for every important item so it opens in one click:
   `https://mail.google.com/mail/u/?authuser=<account>#all/<messageId>`
   using the message `id` from the search result.

5. Lead with a real timestamp so a stale run is obvious at a glance. Run `date` — do not
   guess it. If a run was partial or an account failed, say so in that same header.

## Rails

Read and mark-read only. No sending, no drafts, no replies, no deletion, no label changes
other than removing UNREAD. If one account errors — an expired token, usually — note it in
the digest and carry on with the others rather than failing the whole run.
```

## Notes from running this daily

**Snippets beat full reads.** Classifying from sender and subject is accurate enough, and
reading every message is slow and expensive.

**The mark-read rule has to fail safe.** "When unsure, leave unread" is what makes this
usable — the cost of leaving one newsletter unread is nothing, the cost of marking one real
email read is a missed customer.

**Pass `account` on every call.** Multi-account setups quietly default to one of them.
