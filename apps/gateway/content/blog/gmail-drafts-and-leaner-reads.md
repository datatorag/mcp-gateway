---
title: "Your assistant can now run your Gmail drafts end to end"
excerpt: "Two new tools complete the draft lifecycle, and Gmail reads got a compact mode that cuts a typical email to 2% of its former size."
date: "2026-07-18"
author: "Manuel Yang"
category: "Product"
tags: ["gmail", "mcp", "google-workspace", "product"]
---

Back in April I wrote about [the Gmail draft workflow](/blog/ai-powered-email-workflows-gmail-draft-tool): your assistant writes a draft, it lands in your real Gmail drafts folder, threaded into the right conversation, and you revise it from there. That post ended with "hit send from Gmail. Done."

The hitting-send part was still you. As of today, it doesn't have to be.

## Two tools close the loop

`gmail_send_draft` and `gmail_delete_draft` are live. Together with `gmail_create_draft` and `gmail_update_draft`, that's the whole draft lifecycle: create, revise, send, or discard.

The flow we care about hasn't changed, it just got shorter. The AI drafts. You review in Gmail. The AI sends only what you approved. Before today, approval meant opening the draft and clicking send yourself. Now you can read the draft on your phone while waiting for coffee, come back to the conversation, and say "send the first two, rewrite the third." Nothing goes out that you haven't seen.

`gmail_delete_draft` handles the other outcome. Sometimes a draft is wrong enough that editing isn't worth it. Previously the dead draft just sat in your folder until you cleaned it up by hand. Now "scrap that one" actually scraps it.

If you want the deeper workflow patterns (batch drafting ten replies at once, follow-up sequences, drafts as a review surface for your manager), the [April post](/blog/ai-powered-email-workflows-gmail-draft-tool) covers those and they all still apply. This post is just the missing last step.

## Gmail reads went on a diet

The other half of this release is about tokens.

`gmail_read` used to have exactly one mode: the full Gmail API response, raw MIME tree and all. Multipart boundaries, base64 chunks, forty-odd headers nobody asked about. Marketing emails are the worst case. One paragraph of actual text wrapped in a small novel of tracking-pixel HTML.

The new `text_only` option returns what an assistant needs: flattened from/to/cc/subject/date, the decoded plain-text body (with a fallback to tag-stripped HTML when there's no text part), and attachment names and sizes instead of the raw MIME. On a typical marketing email, that's about 2% of the full response size. Not 2% smaller. 2% of the size.

There's also `max_body_chars`, which truncates long bodies and marks where the cut happened. Setting it implies `text_only`, since capping a raw MIME payload mid-base64 wouldn't help anyone.

Both are opt-in. If you pass neither, `gmail_read` returns exactly what it always has.

Search got the same treatment. `gmail_search` and `gmail_list` results are now flattened to `{id, threadId, from, to, subject, date, snippet, labelIds}` per message, which is enough to decide what to read next without a follow-up call per result.

## The bug I found while doing this

Flattening the search results surfaced something embarrassing. We were passing `metadataHeaders` to the Gmail API as one comma-joined string instead of an array of header names. The API read it as a single header called "From,To,Subject", which matches nothing. So search and list results have been missing From and Subject this entire time.

Nobody reported it, and I think I know why: assistants quietly worked around it by calling `gmail_read` on each result to get the sender, which happened to also be the expensive pattern the flattened format now replaces. The bug hid inside the inefficiency.

That one's on me. It shipped broken, and it stayed broken because the failure was silent. It's fixed now, and the flat result shape makes this class of miss visible immediately: if `from` came back empty on every row, you'd notice.

## Try it

Full parameters and examples are in the [Gmail docs](/docs/gmail), and the release notes are on the [changelog](/changelog). If your Workspace account is already connected, there's nothing to update. The tools are live, and the read defaults are untouched until you opt in.
