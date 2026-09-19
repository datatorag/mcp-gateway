---
title: "Mail your assistant sends now carries your Gmail signature"
date: "2026-09-18"
tags: ["gmail", "gws-mcp"]
connector: "google-workspace"
---

Email sent through the Gmail connector now ends with the signature you set in Gmail, the same
one Gmail adds when you write the message yourself. It applies to `gmail_send`, `gmail_reply`,
`gmail_forward` and `gmail_send_draft`. There is nothing to configure: the signature is read from
the address the message is sent from, so an alias gets its own.

**Where it goes.** On a new message the signature closes the body. On a reply or a forward it
sits under your note and above the quoted message, where Gmail puts it.

**Drafts are signed when they are written.** `gmail_create_draft` and `gmail_update_draft` add the
signature the way Gmail's own Compose does, so a draft you review in Gmail already carries it, and
sending it from Gmail or through `gmail_send_draft` never adds a second one; `gmail_send_draft` signs
only a draft that has none. Pass `signature: false` on the draft tools to leave it out.

**Turning it off.** Pass `signature: false` on any of the four send tools and the message goes out
exactly as written. Asking your assistant to "send this without my signature" does it.

**The response says what happened.** Every send returns a `signature` field: `applied`,
`none_set` when the account has no signature, `suppressed` when you turned it off,
`already_present` when the body already ended with it, `unavailable` when the signature could not
be read and the mail went out unsigned, and `skipped_unsupported_draft` when a draft's format is
one we send untouched rather than rewrite.

Replies and forwards also changed shape underneath. They are now sent with both a plain-text and
an HTML version, as new messages already were, so a plain-text reply keeps its plain-text part
when a signature is added. The signature itself lives in the HTML version only.

One thing you may notice on a phone: Gmail's mobile apps fold a signature they recognise behind
the three-dot button, including on mail you wrote by hand. That is Gmail's display, not a missing
signature.

*Corrected September 18: drafts were unsigned when this shipped; they are signed from the same
day's follow-up release.*
