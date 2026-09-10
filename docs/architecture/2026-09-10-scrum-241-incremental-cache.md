# SCRUM-241: incremental prompt caching, and smaller reads in the multi-account skills

## Problem

A seven-mailbox morning brief hit the run's token ceiling after four model
calls and twenty-six tool calls, before it had labelled, created or sent
anything. The ceiling arithmetic was right (SCRUM-236). What drove it was
the cache shape: only the system prompt and the tool schemas were cached,
so every tool result was uncached input again on every later step. One
pass over seven mailboxes at fifty results each cost about forty thousand
tokens, and each following step paid that again in full.

## Rule

Every model call in a run carries one cache breakpoint on the latest
message, in addition to the two that already sit on the system prompt and
the last tool schema. Anthropic caches the whole prefix up to a breakpoint,
so with the breakpoint on the latest message each step writes only what
arrived since the previous step and reads everything before it at the
cache-read weight. There is never more than one breakpoint on the
messages: the processor removes any mark it put on an earlier message
before marking the latest, so the four-breakpoint limit is never reached
and nothing accumulates in a stored thread.

The multi-account skills read at most twenty-five results per search
where they said fifty: a pass is half the size, and a truncated search is
still reported as a sample, exactly as before.

The ceiling constant stays where it is. Whether it can come down, or the
step budget go up, is a later measurement on the new shape.

## Where it lives

- A Mastra input processor with a per-step hook (`processInputStep`),
  registered on the playground agent. Per step it clears any Anthropic
  cache-control mark from every message part, then marks the newest part
  that becomes a block on the wire (a trailing step marker is skipped).
  Provider metadata on a text part reaches the provider as that block's
  cache control. A stored tool part's metadata is handed by the runtime to
  both the tool-call block and its tool-result block, so a tool tail
  carries the mark on those two adjacent blocks: one breakpoint's worth of
  prefix, and four breakpoints in total with the two that already exist,
  which is the provider's limit. Because every earlier mark is cleared
  first, the total can never grow past that. An unrecognised provider
  ignores the metadata and runs uncached, as the existing breakpoints do.
- `content/skills/morning-brief.md`: `max_results` 50 becomes 25 for the
  calendar read and the unread-mail search.

## Expected arithmetic

Weighted tokens are `uncached input + cache write + 0.1 x cache read +
output` (SCRUM-236). For the measured four-step run (input totals 39,368 /
41,539 / 80,678 / 90,068; outputs 735 / 2,824 / 996 / 3,184; a 35,652 token
cached prefix), the old shape weighed 163,131 and tripped the 150,000
ceiling. With the breakpoint on the latest message the same four steps
weigh about 40,103 + 8,932 + 44,289 + 20,642 = 113,966: each step writes
only its new content and reads the rest at a tenth. Halving the mail read
takes roughly another fifteen thousand off the pass. A seven-mailbox pass
then costs about twenty-five thousand tokens once, and about two and a half
thousand on each later step, instead of forty thousand on every step.

Anthropic prices a cache write at a quarter more than an uncached token and
a cache read at a tenth, so the real cost follows the same shape: a little
more on the step that writes, much less on every step after it.

## Proven and not proven

Proven by test, against the bytes of the real provider request: on a
one-step turn the only mark among the messages is on the last block of the
last message; on a turn whose first step calls a tool, the second request
carries its newest mark on the tool-result block, at most one more on the
adjacent call block, none on the user message that carried it a step
earlier, the existing system and tool breakpoints untouched, and no
top-level mark. The skill text reads twenty-five, and a test refuses any
published skill that asks a search for more. Not proven: the weighted total of a live
seven-mailbox brief on the new shape, which is a visible-browser run and
the telemetry after it.
