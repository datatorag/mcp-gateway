---
title: "Read a Whole Gmail Thread in One Call, and How We Knew to Build It"
excerpt: "An agent that wants a whole email conversation used to get it one message at a time, or by going around us to Google's raw API. Our usage record showed the second one happening, so there is now a tool for it: every message of a thread, oldest to newest, in one call."
date: "2026-11-17"
author: "Manuel Yang"
category: "Product"
coverImage: "/blog/read-a-whole-gmail-thread.png"
tags: ["gws-mcp", "gmail", "mcp"]
---

A month ago I wrote that we had [read what people used the raw API call for](/blog/we-read-what-the-raw-api-call-was-for) and built nine tools from it. In that post I said there was nothing left that an outside user needed the raw call for. That was wrong, and the same record showed me where.

## What the record showed

Our Google Workspace connector has a tool called `gws_run` that sends one raw request to a Google API. It is hidden from almost every account. For the few that still see it, we record which API resource and method each raw call used, and the names of its parameters. Names only, never values.

This week one of those accounts was asking Gmail for whole threads through the raw call, many times a day, from Claude Code. The method was `users.threads.get`.

I checked what we offered instead. `gmail_read` takes a message id and returns one message. A thread id was accepted for trashing a conversation and for labeling one, and by nothing that reads. An agent that wanted the whole conversation had two choices: call `gmail_read` once per message, or go around us. It went around us, which is the faster of the two.

## The tool

`gmail_read_thread` takes the thread id that `gmail_search`, `gmail_list` and `gmail_read` already return, and answers with every message in the conversation, oldest to newest, in one call.

![One gmail_read_thread call returning a two-message conversation in order, oldest first, each message marked as in Trash](/blog/read-a-whole-gmail-thread.png)

It has two depths.

- `full`, the default, gives each message's from, to, cc, subject and date, its text body, and its attachments with the part ids `gmail_get_attachment` takes.
- `headers` gives the same headers and Gmail's snippet with no body. That is the cheap look at a long conversation before reading the messages that matter.

Drafts and messages in Trash are part of the answer, each marked. I would rather an agent see a trashed message and know it is trashed than have the tool decide the message does not exist.

## Long threads

A thread with a hundred replies will not fit in one answer, and cutting it off wherever the size limit lands would drop the newest messages, which are usually the ones being asked about.

So the bodies in one answer are held to 200,000 characters together, and the newest are kept first. When a thread runs past that, the oldest messages keep their headers and lose their bodies, and the answer says so: a `left_out` list with those message ids, each readable in full with `gmail_read`. `max_body_chars` cuts each body before the total is applied, for an agent that wants a little of everything.

Nothing is dropped without the answer naming it.

## Why a new tool and not an argument on the old one

We could have added a `thread_id` argument to `gmail_read`. We did not, for two reasons.

An agent holding a thread id looks at tool names first. A tool with "thread" in its name gets picked. An extra argument on another tool is invisible until the agent reads that tool's schema, and the raw calls are the evidence that it did not.

The second reason is the check we run before any call reaches Google. `gmail_read` requires a message id, and the gateway refuses a call without one. Making that optional to let a thread id in would have loosened the check for every existing call.

The descriptions of `gmail_search`, `gmail_list` and `gmail_read` now say where a thread id goes, and `gws_run` points at the new tool for this job.

## What the record could not tell me

The same account made a few raw calls for single messages with a `format` parameter. We record that the parameter was there and not what it was set to, so I do not know whether the agent wanted the raw message, the headers alone, or something `gmail_read` already returns. Nothing was built for it. If the next read of the record shows it again, I will ask.

That limit is deliberate. A record that kept values would hold search queries and message ids, and I would rather be short a fact than hold those.

## Shipped the same day

The gap went from noticed to live on production in one day: the tool, its registry row, the docs, and a test that reads a two-message thread on production at both depths and checks the order. The test passed on its first run.

The [changelog entry](/changelog#read-a-whole-gmail-thread-at-once) has the short version, and the [Gmail docs](/docs/gmail) list the tool with the rest. If your agent still reaches for something we do not have a tool for, tell me what it was.
