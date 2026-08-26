---
title: "Claude Can Send Formatted Email Now. Here's What That Took."
excerpt: "Until August 26, our Gmail tools sent every message as plain text, so asking Claude for a formatted email got you literal HTML tags in your inbox. Here's the fix, the one asymmetry to know about, and where the workflow builders stand."
date: "2026-08-26"
author: "Manuel Yang"
category: "Product"
tags: ["gmail", "claude", "mcp", "email", "google-workspace"]
---

A plain-text-only email tool is not a limitation you notice until you ask for something
formatted. Then you notice it all at once, because what lands in the inbox is
`<h2>Priority items</h2>` as visible text.

That happened to us. Our own daily inbox digest, built on our own Gmail tools, came out as a
wall of tags the first time we asked Claude to make it readable. The send path hardcoded
`text/plain`, a decision nobody remembered making, and every request for formatting just
poured HTML into a field that would never render it.

As of August 26, that's fixed. Here's what shipped, and the details worth knowing before you
rely on them.

## One parameter, sensible defaults

`gmail_send`, `gmail_create_draft`, and `gmail_update_draft` now take `html_body`. Pass it and
the message goes out as `multipart/alternative`: HTML clients render your formatting,
plain-text clients get a readable fallback. If you also pass `body`, that text IS the
fallback. If you don't, one gets derived from the HTML, so you can't accidentally send a
message that's empty for half your recipients.

In practice you don't write the parameter at all. You say "email me the summary with the
action items as a list and links I can click", and Claude fills in `html_body` for you. The
parameter exists so the model has somewhere honest to put the formatting.

One implementation detail I'll defend: the plain part comes first in the MIME structure,
because mail clients render the last part they support. Get that backwards and HTML clients
show the fallback. It's the kind of thing you only learn by sending yourself a lot of test
email.

## The asymmetry you should know about

`gmail_reply` and `gmail_forward` also accept `html_body`, but they behave differently: those
paths send single-part `text/html` with no plain-text fallback.

Why? Replies and forwards hand quoting and threading to a composer that has one body slot.
Building a faithful plain-text alternative of a quoted HTML thread is a project in itself, and
a bad fallback is worse than none. So the same parameter name means "multipart with fallback"
on a fresh send and "HTML only" on a reply. We wrote it into the tool descriptions, and I'm
writing it here, because a parameter that behaves two ways is exactly what you hit at the
wrong moment.

While we were in there, `gmail_forward` gained a plain `body` it never had. Before this you
could forward a message and not say anything above it, which made forwarding oddly mute.

## What about Zapier and n8n?

They can do this. Let's be clear about that, because "other tools can't send HTML email" would
be false and you could check it in thirty seconds. Zapier's Gmail Send Email action has a body
type field, and n8n's Gmail node has an Email Type option with Text or HTML. Both checked
against their docs on August 26, 2026.

The difference isn't the capability, it's what you do to get it. In Zapier or n8n, HTML email
comes out of a workflow: you build the zap or the node graph, wire the trigger, template the
body, then it runs the same way every time. That's automation, and for a fixed recurring
message it's the right shape.

What we're doing is different in kind: your mailbox is connected to a conversation. "Send it
as a table instead" is a sentence, not an edit to a workflow. The formatting can be different
every time because a model is writing it fresh against whatever you just asked. Connected
beats automated when the message isn't the same twice.

Claude's own native Gmail connector is the other alternative worth knowing, and it sends email
too. We keep a dated capability comparison in
[the native-connector post](/blog/claude-gmail-connector-vs-datatorag-send-reply), which we've
corrected twice as Anthropic shipped verbs, so I'd rather point you there than restate a table
that moves.

## What we did with it first

The first real use was our own [inbox triage skill](/skills/inbox-triage): a daily digest,
mailed to yourself, with a dated-items box at the top and anchor links instead of bare URLs.
That routine is a whole post on its own, including a prompt-injection hole we caught before
publishing it. It's here: [how to stop reading your inbox](/blog/stop-reading-your-inbox).

If you just want the capability: connect Gmail at [datatorag.com](https://datatorag.com/dashboard),
then ask for the email the way you'd describe it to a person. Formatted, this time.
