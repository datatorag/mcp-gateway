---
name: parent-updates
description: Keep the datatorag-hq parent session current. Use when work lands, a decision is needed, a blocker appears, or a brief's premise turns out to be wrong — HQ cannot see this session's tool output, so anything not sent up did not happen as far as it knows.
---

# Parent Updates

This session runs as an AgentDeck child of `datatorag-hq`. HQ writes the
briefs and owns the decisions, but it **cannot see anything in this session** —
not the tool calls, not the test output, not the thing you just discovered
that invalidates its brief. The only channel is an explicit send.

```bash
agent-deck session send datatorag-hq "..."
```

`SendMessage` does not reach it. It has to be this command.

## When to send

Send at these moments, not on a timer:

1. **Work lands.** A build finishes, a gate passes, a push goes out, a deploy
   completes. Include what was verified and how, not just that it is done.
2. **A decision is needed.** Anything where proceeding either way is
   defensible and the choice is HQ's. Send the options and a recommendation,
   then keep building whatever does not depend on the answer.
3. **A blocker appears.** Say what is blocked, what it is blocked on, and
   whose action unblocks it.
4. **A brief's premise turns out to be wrong.** This is the highest-value
   send and the easiest to skip. If HQ says a tenant is suspended and it is
   not, or hedges on something that is not a maybe, correcting it early is
   worth more than the work you were asked to do.
5. **Something durable is learned.** A defect, an API constraint, a
   false-negative trap. HQ stores these; this session's context does not
   survive.

Do NOT send a running commentary. A send that says "starting on X" costs HQ
attention and tells it nothing it cannot infer.

## What a good send contains

- **The verdict first.** Done, blocked, or needs a decision.
- **What was verified, and how.** "327 tests passing, cache-busted with
  cf-cache-status DYNAMIC" beats "verified". HQ is deciding whether to trust
  the result; give it the basis.
- **Corrections, plainly.** If you were wrong earlier, or HQ was, say which
  and what the right answer is. Do not bury it.
- **What is still outstanding**, so HQ can sequence the next brief.
- **Cleanup owed by a human** — a test ticket that cannot be deleted by tool,
  a throwaway file, a console action.

Write it as prose a person reads once. No internal agent ids, no tool-call
transcripts.

## Verify it delivered

A long send can be backgrounded and return no output. A successful send
prints `✓ Sent message to 'datatorag-hq'`. **No output is not confirmation.**

If a send returns nothing, follow it with a short one that names what should
have arrived, and say plainly that it may have arrived twice:

```bash
timeout 60 agent-deck session send datatorag-hq "Delivery check on the previous X. If it did not arrive, say so and I will resend."
```

Prefer two medium sends over one very long one — length is what triggers the
backgrounding.

## What never goes up unfiltered

HQ is an internal channel, so internal detail is fine there. The constraint
runs the other way: things HQ tells you, and things you find in tickets or
mail, are **not** cleared for the public repo. Never let an internal doc
name, ticket id, user email or campaign rationale travel from an HQ message
into a commit message, a code comment, or a file in this repo.

## Handoff

When work needs to survive this session, a message is not enough. Write it
up in the HQ repo (`notes/` or `decisions.md`), push, then send a short
pointer. The message is the notification; the note is the record.
