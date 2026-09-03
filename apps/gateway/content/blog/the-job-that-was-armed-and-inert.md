---
title: "We Published Our Inbox Triage Routine. Then It Quietly Stopped Running."
excerpt: "The scheduled job missed three of the next ten days and every check passed. Firing and noticing are different jobs, and a check you write cannot verify a run that never happened."
date: "2026-09-03"
author: "Manuel Yang"
category: "Engineering"
tags: ["automation", "reliability", "gmail", "mcp", "scheduling"]
---

A week ago I wrote up [how we stop reading our inbox](/blog/stop-reading-your-inbox): a routine
that reads a day of unread mail across every connected mailbox, labels and clears what does not
need a human, and mails one digest of what does. That post described four decisions behind the
steps and opened with a line I believed when I typed it.

*"I run it every morning across several mailboxes."*

In the ten days after it published, the routine did not run on three of them. On a fourth it ran
at 22:46 instead of 09:04, which is not triage, it is a summary of a day you already lived.

Nothing alerted. That is the part worth writing about, because every check we had passed while it
was happening.

## Armed and inert

The routine was scheduled by an in-session cron: a job held inside a long-running assistant
session. Asking the session to list its jobs showed the job. Asking the process manager showed the
session alive. No error was raised anywhere, by anything.

The scheduler had three independent ways to stop, and not one of them surfaces:

- it fires only while that session is idle, so a session busy at the appointed minute silently
  skips the fire
- it expires after seven days
- it dies with the session

Each of those is defensible on its own. Together they mean the job's existence and the job's
execution are different facts, and we were only ever checking the first one.

So we moved the schedule to the operating system. On macOS that is launchd; on Linux it is systemd
timers or plain cron. Any of them fixes the same thing, which is firing.

**Firing was not the interesting half.**

## Firing and noticing are different jobs

The proof was already sitting on the same machine. Another launchd job, unrelated, loaded and
firing on schedule exactly as designed. Asking launchd about it reports its last exit status.

The last exit status was 1. It had been failing for days. Nothing said so, because nothing was
asking.

A scheduler's job is to start things. It is not a monitor, it does not care whether the thing
worked, and moving to a better scheduler improves the odds a run begins while changing nothing
about whether anyone finds out it did not. If we had stopped at "use launchd," we would have
reproduced the original failure one layer down and felt good about it.

## A check you write cannot verify a run that did not happen

Our check asked a reasonable-sounding question: does today's dated run log exist?

That file is written by the run being checked.

A run that never fires writes no log. It also writes no error, no alert and no evidence of its own
absence. The check sees a missing file and cannot distinguish "the job did not run" from "the job
ran and the log is late" from "today was quiet." Worse, when the check itself was broken, its
passing answer was an absence, so a broken check passed automatically.

This is the general shape and it is worth stating plainly: **when the passing result of a check is
that nothing is there, a broken check is indistinguishable from a healthy system.** If you take one
thing from this post, take that sentence and go look at your own alerting for it. Ours had the
problem in two places and we only noticed the second one because we went looking after the first.

The fix has two parts.

**Run a positive control in the same pass.** Something that must fail if the instrument is broken.
If your check cannot fail, it is not a check, it is a decoration that reports green.

**Move the success signal to something you did not write.** Ours is now the digest itself. The
routine mails you one message; the verifier goes and looks for that message in the inbox, through
the same connector everything else runs on. If the mail is there, the run happened, because a run
that did not happen cannot produce it. A file on disk proves that something wrote a file. A
delivered email proves the work reached the person it was for.

## What the schedule looks like now

One job, not two. It fires once, hands the work to the assistant session that holds the mail
connections, and then polls every fifteen minutes for an hour.

It notifies on exactly five events: the run was handed off, the handoff failed, the digest arrived,
the digest arrived but something in the run errored, and the hour elapsed with no digest. That last
one is a failure, stated as a failure, rather than a silence you have to interpret.

Five is not a design flourish. Every notification you add that means "still fine" trains you to
ignore the one that means "it did not run," and the whole point is a signal you still read on the
day it matters.

## The unglamorous part

Two of these mistakes are the same mistake. The cron check and the log-file check both answered a
question about our own bookkeeping and let us believe we had answered a question about the world.
The job exists. The file exists. Neither says a single message got triaged.

The routine itself did not change. The [decisions behind it](/blog/stop-reading-your-inbox) still
hold, and the one I would still defend hardest is labelling before marking read: the labels are
what make a bad run auditable and reversible, and they are the reason none of these misses cost
anything. A routine that skipped a day left yesterday's mail unread, which is exactly what mail
does on its own.

The scheduling half is now honest, which is more than the first post could say.
