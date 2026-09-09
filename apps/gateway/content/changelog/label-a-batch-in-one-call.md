---
title: "Label a batch in one call"
date: "2026-09-09"
tags: ["gmail", "gws-mcp", "skills"]
connector: "google-workspace"
---

`gmail_label_message` now leads with the batch form. Pass `message_ids` (up to
1,000) with `add_labels` and `remove_labels` and every message is modified by one
request, so an agent no longer works through a triage pile one message at a
time. The label-and-mark-read pair is a single call: `add_labels` set to the
label id, `remove_labels` set to `["UNREAD"]`.

The result now lists every id with its own outcome. When Gmail refuses the
batch request, each id is retried on its own and reported, so a partial batch is
visible instead of an all-or-nothing error.

The inbox-triage and morning-brief skills say the batch form explicitly.
