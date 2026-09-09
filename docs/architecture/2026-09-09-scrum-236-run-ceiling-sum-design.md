# SCRUM-236: the run ceiling counts what a step adds, not what it replays

A morning-brief run from the dashboard skill card stopped after two tool
calls with the notice "This run reached its size limit". The seed was
correct and the mailbox was small. The run had used 81,206 tokens of a
150,000 ceiling and was refused its third model call.

## What was established

From the run's own `$ai_generation` events and its stored thread (fresh
thread, two messages, so memory recall played no part):

| call | input total | of which cache write | of which cache read | output | counted by the old sum |
|---|---|---|---|---|---|
| 1 | 39,087 | 35,652 | 0 | 61 | 74,800 |
| 2 | 39,691 | 0 | 35,652 | 2,367 | 77,710 |

Old sum after two calls: 152,510, over the ceiling, third call refused.
Real tokens after two calls: 81,206.

The old sum, `input.total + cacheRead + cacheWrite + output`, was written on
the premise that the provider reports cache tokens exclusively of input.
That is true of Anthropic's raw API and false of what the wrapper receives.
The AI SDK's v3 usage shape (`@ai-sdk/provider` 3.x and 4.x,
`LanguageModelV3Usage`) defines `inputTokens.total` as the total number of
input tokens and `noCache` as the uncached part, and `@ai-sdk/anthropic`
4.0.21 fills it that way: `total = input_tokens + cache_creation + cache_read`.
The v2 shim in `ai` 7 does the same for a v2 model: `total` is the model's
`inputTokens`, `cacheRead` is its `cachedInputTokens`, `noCache` is left
undefined. So every cached token was counted twice, and the unit test pinned
the double count with the same wrong premise in its comment.

What the 35,652 cached tokens are: the tool schemas plus the system prompt.
The registry serves 90 tools (47k characters of Google Workspace schema JSON,
10k of Atlassian, plus the built-ins) and the system prompt is 5k
characters. The seeded skill is about 3,400 tokens and arrives once as
uncached input on call 1. The `gmail_list` result was 704 bytes. The seeded
text is not the consumer; the schema prefix replayed on every step and
counted twice is.

Why `gmail_list` and not the skill's `gmail_search`: the run never reached
step 3. The stored assistant message holds exactly two tool invocations and
no prose: `list_connected_accounts {}` and `gmail_list {label: INBOX,
max_results: 1}` on the first account. A one-message probe reads as the
model establishing "the time of your previous run", which the skill's window
step leaves to the model without naming a call. `gmail_list` describes
itself as "List recent emails from the inbox", the natural pick for "what is
the latest", and the search would have been the next step. Steering by
description, not the model ignoring the text; and a gap in the skill's
window step.

The SCRUM-234 five-step default was not in play (two steps of five). It is
the next wall: with the count corrected, a brief needs dozens of steps and
the library default cuts it at five. That fix is specified in SCRUM-234 and
has to land before a full run completes.

## Fix 1: the sum states the SDK's shape

`usageTotal` in `src/mastra/run-token-budget.ts` reads the v3 buckets as
the SDK defines them. Uncached input is `noCache` when the provider gives
it, otherwise `total - cacheRead - cacheWrite` (the v2 shim leaves `noCache`
undefined). A one-line comment at the sum names the shape it assumes and
the SDK version, because that premise is exactly what rotted.

The tests feed the v3 shape with `total` already including cache, and the
expected values are this run's real events: 39,148 and 42,058 tokens for
the two calls, 81,206 together.

## Fix 2: a cache read is not fresh input

The ceiling is a cost and abuse guard. A cached read costs about a tenth of
an input token, so the ceiling weights it at a tenth:
`RUN_CACHE_READ_WEIGHT = 0.1` beside `RUN_TOKEN_CEILING` in
`src/gateway/billing/plans.ts`. Cache writes and uncached input count in
full, output counts in full. The sum is

    noCache + cacheWrite + RUN_CACHE_READ_WEIGHT * cacheRead + output

Under that sum this run weighs 39,148 for call 1 (the prefix is written
once, in full) and 9,971 for call 2 (4,039 uncached + 3,565 for the prefix
read + 2,367 output): 49,119 against 150,000, and the third call would have
run.

## What a full brief costs, honestly

Each later step pays the prefix read at 3,565 weighted plus its own uncached
input and output. The uncached input is not small: the only cache breakpoint
is on the system prompt (and the last tool), so the conversation itself,
seed plus every tool result and every assistant turn so far, is uncached
input on every step. Call 2 already carried 4,039 uncached tokens with one
tiny tool result in the history.

Estimate for a two-account brief, about 25 steps, with roughly 40k tokens of
tool results and 10k of output by the end:

- Prefix reads: 25 x 3,565, about 90k.
- Prefix write once: 35,652.
- Seed, replayed uncached each step: 25 x 3,400, about 85k.
- Tool results, replayed uncached and growing: about 1.6k per step on
  average, so 1.6k x (1 + 2 + ... + 25), about 520k.
- Output: about 10k.

About 740k weighted. It does not fit 150,000, and the constant is not the
problem: any sum that charges the replayed conversation at full weight
grows with the square of the step count. Two things change that, and both
are outside this ticket:

- A moving cache breakpoint on the latest message each step (Anthropic's
  incremental caching), so the conversation is a cache read at a tenth.
  The estimate drops to about 240k.
- The follow-up below: a skill-seeded turn exposes the skill's tools plus
  the built-ins, which cuts the prefix from 35,652 to roughly a fifth of
  that. With both, the same brief estimates at about 130k, which fits.

So fixes 1 and 2 make this run 49k instead of 152k and let a short brief
finish. A full multi-account brief needs the follow-up and incremental
caching, or a run ceiling sized for skill runs. That is HQ's call; this
spec does not raise the constant.

## Fix 3: the stop names the limit and offers a way on

Specified here, not built in this branch. The notice says which limit
stopped the run and how many steps completed, and offers Continue, which
sends a fixed continuation message in the same thread so the model resumes
from its own last state rather than the seed. The fresh run id already gives
a fresh budget. Until then "Send a new message to continue" is literally
true and the thread keeps the finished steps.

## Follow-up ticket (SCRUM-238): a skill run sees the skill's tools

A skill declares its tools (the morning brief names ten). A skill-seeded
turn should expose those plus the built-ins and nothing else. That removes
most of the 35,652-token prefix and the `gmail_list` steering at the same
time, because the steering tool is not in the list. Its own id and spec.

## Copy note

`gmail_list`'s served description reads as the obvious first call for
"unread inbox mail". If HQ wants it steered away from that, it is a
registry-row copy change in the same surgical UPDATE shape as SCRUM-233,
not a code change.

## Tests

- `usageTotal` fed the v3 shape with `total` including cache: this run's two
  calls give 39,148 and 42,058 unweighted, 49,119 weighted together.
- The wrapper, fed a v2 model (the shim's shape): the derived uncached part
  is `total - cacheRead`.
- The crossing test is unchanged in meaning: the crossing call completes,
  the next is refused, budgets are per run, no run id means identity.
