---
title: "Claude can send properly formatted email now"
date: "2026-08-26"
tags: ["gmail", "email", "tools"]
connector: "google-workspace"
---

Until today, every email sent through DataToRAG went out as plain text. If you asked Claude for
a formatted summary with links, the recipient got the HTML as visible tags.

**`gmail_send`, `gmail_create_draft` and `gmail_update_draft` now take an `html_body`.** The
message goes out as `multipart/alternative` with a plain-text fallback, so clients that render
HTML show your formatting and clients that do not still get something readable. Pass `body` as
well and that becomes the fallback part; leave it out and we derive one from the HTML.

**`gmail_reply` and `gmail_forward` take `html_body` too, and behave differently in one way
worth knowing.** They send single-part `text/html` with no plain-text alternative, because
those paths hand quoting and threading to a composer that builds the whole message. Same
parameter, same result in a normal mail client, but no fallback part. We would rather tell you
that than have you find it.

One smaller fix came with it: **`gmail_forward` now accepts a `body`.** It never did. You could
forward a message but not say anything above it.

Nothing changes if you were already sending plain text. `html_body` is optional everywhere and
no existing call behaves differently.
