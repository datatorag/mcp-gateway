---
title: "Replies go where Gmail would send them"
date: "2026-10-03"
tags: ["gmail", "tools"]
connector: "google-workspace"
---

When Claude replied to an email for you, the reply went to whoever was in the From line. That is wrong in two common cases. A message with a Reply-To address, such as a booking system or a support desk, wants the answer somewhere else. And a reply to a message you sent yourself went back to you.

`gmail_reply` now addresses a reply the way Gmail's own Reply button does:

- To the Reply-To address when the message has one, otherwise to the sender.
- To the people you wrote to, when the message is one you sent.
- To everyone on the original when you ask for it, with the new `reply_all` option. It is off unless you ask, and it leaves your own addresses out.

The response says who the reply went to. Because a Reply-To can point somewhere other than the sender you see, there is also a guard: pass `expected_to` with the address or addresses you mean to answer, and the reply is refused before anything is sent unless it would go to exactly those.

One more fix. `gmail_mark_read` used to mark a message read even when you only asked it to add a label. It now does exactly what you ask: with no labels given it marks the message read, and with labels given it applies those and nothing else.
