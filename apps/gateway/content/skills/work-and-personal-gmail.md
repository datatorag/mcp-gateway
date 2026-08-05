---
title: "Search work and personal Gmail in one prompt with Claude"
order: 7
situation: "The receipt is in my personal inbox and the thread about it is in my work one, and I am the one switching between them."
produces: "One answer assembled from every account you connected, or from exactly the one you name."
tools: [gmail_search, gmail_read]
accounts: multiple
---

# Two mailboxes, one question

Most integrations hold one token per service. That is not a missing feature,
it is a shape: with one token there is one mailbox, and "check both" is not
something that can be added later.

Here every tool takes an optional `account`. Omit it and you get your default.
Name one and you get that mailbox. Ask a question that spans accounts and the
assistant runs the search once per account and assembles the answer.

```markdown
---
name: work-and-personal-gmail
description: Work across several connected Gmail accounts in one conversation
---

# Multi-account Gmail

## Know what you are connected to

Start with `list_connected_accounts`. It groups by service and marks which is
the default. You cannot target an account you have not connected, and
guessing an address produces a confusing error rather than an empty result.

## Targeting

Every Gmail tool takes an optional `account`.

- Omitted → the default account.
- `account: "you@example.com"` → that account.

For a question that spans accounts, run the search once per account and label
each result with the account it came from. NEVER merge results from two
mailboxes into one undifferentiated list — "the receipt" and "which inbox the
receipt is in" are both part of the answer.

## The pattern that makes this worth doing

Find in one, act in the other:

1. `gmail_search` in the personal account for the receipt or confirmation.
2. `gmail_read` it, with `text_only: true`, for the number or date.
3. Use that in the work account — a reply, a draft, a calendar entry.

That is the shape a single-account integration cannot express at all. It is
not slower there, it is impossible.

## Rules

1. **Always say which account.** Every result, every action. An answer that
   does not name the mailbox is an answer the reader has to verify.
2. **Never cross-post without being asked.** Reading across accounts is the
   feature. Sending from one because you found something in another is not —
   confirm the sending account explicitly first.
3. **Search each account separately.** There is no cross-account query; the
   assistant does the fan-out. Expect one call per account.
4. **Be careful with defaults on writes.** A write with no `account` goes to
   the default mailbox, which may not be the one you were just reading.
```

## Notes from running this

**The account parameter really does switch mailboxes.** Running the same query
against two connected accounts returns different mail from different senders —
not a filtered view of one mailbox. Each account carries its own OAuth grant,
which is why this works and why connecting each one is a separate consent.

**Reading across accounts is safe; writing across them needs care.** The
default-account behaviour is convenient for reads and dangerous for writes,
because a `gmail_send` with no `account` goes wherever the default points.
That is the reason the rule about naming the sending account is in the skill
and not in this note.

**One thing this genuinely cannot do.** These are separately connected
accounts, each authorised by you. It is not delegated or shared mailbox
access — there is no way here to read a mailbox you have not personally
connected, and nothing in this skill grants access to someone else's mail.
