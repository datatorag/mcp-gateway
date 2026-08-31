---
title: "The Model Didn't Hallucinate. Our Tool Description Was Missing."
excerpt: "We read the failed calls on a real account and found something uncomfortable: most of them were not the model getting it wrong. They were our tool descriptions failing to say what the tool could do, and in one case failing to offer something it should have offered."
date: "2026-08-31"
author: "Manuel Yang"
category: "Engineering"
tags: ["mcp", "tools", "claude", "google-workspace", "developer-experience"]
---

A user on DataToRAG made a few hundred Google Workspace calls over two days, chaining Docs and
Sheets together in a way we had not seen anyone do before. A handful of those calls failed. I
sat down expecting to read a list of a model getting confused.

That is not what the list said.

## Three failures, and we caused all three

The first one:

```
docs_get: unknown parameter "view_range". Accepted: "document_id", "mode"
```

The model asked to read part of a document. Our `docs_get` takes a document ID and a mode, and
that is all it takes. There is no way to say "just this section". So the model reached for a
parameter that would obviously exist if anyone had thought about long documents, found nothing,
and failed.

**That is not a hallucination. That is a feature request, written in the only language a tool
call has.** When a model invents a parameter, it is usually describing the shape of the hole.

The second:

```
requests[0].replaceAllText.matchCase: Unknown property.
Valid properties: ["tabsCriteria", "replaceText", "containsText"]
```

Google nests `matchCase` inside `containsText`. The model put it at the top level. Our tool
description for `docs_batch_update` never showed what a request actually looks like, so there
was nothing to copy and the model guessed a reasonable structure that happened to be wrong.

Our error message here is good. It names the valid properties. But it arrives after a failed
call, and a description that showed one worked example would have prevented the call from being
made wrong in the first place.

The third one is the one that stung:

```
Unable to parse range: Sheet1!A1:A100
```

The spreadsheet had no tab called `Sheet1`. And where did `Sheet1` come from? **Our own
parameter description, which used `Sheet1!A:D` as its example.** The model copied our
placeholder into a real call, and Google handed back a parse error that named the problem
without naming the fix.

## The pattern

Every one of these is the same shape. **The tool surface knew something the description did not
say.** Sheets knows its own tab names and we did not offer them. Docs has a request format and
we did not show it. And in the first case the tool did not know something it should have: there
was no way to read part of a document, so no description could have helped.

Writing MCP tools feels like writing an API. It is closer to writing documentation that
executes. The description is not a comment attached to the real thing. For a model, **the
description is the entire interface.** A parameter you did not mention does not exist. An
example you wrote carelessly is the example that ends up in production traffic.

## What changed

- `docs_get` can now read part of a long document, using the same character indices that
  `mode: "index"` reports and that `docs_batch_update` already consumes. One coordinate system
  across reads and writes, not two. It also reports the document's total length and whether
  what you got back was clipped, so a caller can tell a short document from a truncated one.
- `docs_batch_update` carries a worked example, `replaceAllText` included, so the nesting is
  visible before the call instead of after it.
- `sheets_find_rows` answers a bad tab name by listing the tabs the file actually has, and the
  example in its description no longer names a tab that usually does not exist.

## The part worth stealing

We only found any of this because we read the failed calls on a real account, one at a time,
and asked what each one was trying to do rather than what it got wrong.

**Error logs on an MCP server are not a bug queue. They are the clearest product feedback you
will ever get**, because a model has no ego about the interface and no patience for guessing
twice. It tells you exactly what it expected to find. If you are running tools for agents, go
read your failures this week and count how many are yours.

Ours was most of them.
