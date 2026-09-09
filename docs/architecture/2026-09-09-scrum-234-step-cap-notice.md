# SCRUM-234: a skill run has a step budget, and no cap ends a turn silently

After the ceiling fix, the first morning brief on a real account got through
the account question and then made eight tool calls, wrote one line, and
ended: no label, no task, no brief, no closing prose, no notice. The
composer came back and Regenerate appeared. That is the agent runtime's
default stop condition, five model calls per turn, ending the turn after
the fifth step's tool results.

## What the code said

Nothing in our code set a step cap; the runtime defaults to five when
neither `maxSteps` nor `stopWhen` is given. A step is one model call, which
may carry several parallel tool calls. The UI mapped a tool part left in
`input-available` to a pulsing Running badge from its state alone, and
nothing on stream close changed it.

## Fix 1: the step budget is ours, and sized for the run

`SKILL_RUN_MAX_STEPS = 60` and `CHAT_MAX_STEPS = 12` in
`src/mastra/run-steps.ts`. A skill-seeded turn (the chat route recognises
one) and a scheduled run both pass the skill budget; an ordinary chat turn
passes the chat budget.

Why 60: the real run spent five steps on eight calls (calendar, three mail
searches, the task list, a mail list, the tasks of one list, a second
calendar read), before it had labelled anything, created a task, or written
the brief. A morning brief on one account is about a dozen calls; the
account that failed has seven connected accounts, and the skill's
per-account steps (calendar, search, read a few, label, tasks) multiply
by that. Sixty model calls covers a seven-account brief with room for the
retries the model actually makes, and it is a ceiling against a runaway
loop, not a target. Cost is bounded separately by the run token ceiling,
which is the binding limit until SCRUM-238 shrinks the per-step prefix.

Why 12 for chat: an ordinary question rarely needs more than a few tool
calls, and a chat turn that wants sixty steps is a skill that should be
seeded as one.

## Fix 2: a stop is a notice, never silence

The route's stream instrumentation counts the steps it sees and watches how
the turn ends. If the turn finishes right after a tool result with no
assistant text after it (the shape a step cap leaves; the runtime reports
the finish reason as tool calls), or the run token ceiling refuses the next
call, the route puts one data part in the thread before the stream closes:
`data-run-stopped` with which limit stopped it (steps or size), how many
steps completed, the cap, and the skill slug when the turn was a skill run.

The client renders that part as a card: which limit, how many steps
finished, that everything finished is saved, and Continue. Continue sends a
fixed continuation message in the same thread: pick up from the last
completed step, do not restart, stay within the rails, report at the end.
The route recognises that exact text beside the skill's slug as a skill run
too, so the continuation keeps the no-gates policy and the fresh run id
gives it a fresh budget. A thread reopened later still shows the card, and
Continue still works, because the part lives in the message.

## Fix 3: a stranded tool part stops saying Running

When the last message is complete (the stream closed) and a tool part is
still in `input-streaming` or `input-available`, its card shows
Interrupted instead of Running. The state in the part is unchanged; only
what a settled message says about it changes. The progress row from
SCRUM-237 already disappears on close.

## Tests

- The chat route passes `maxSteps` 60 for a skill turn and 12 otherwise.
- A runtime stream that ends right after a tool result yields a
  `data-run-stopped` part with the step count and the skill; a stream that
  ends with prose yields none.
- The continuation message beside a valid slug is a skill run.
- The card renders the limit and the count, and Continue calls the
  container with the slug; a settled in-flight tool part reads Interrupted.
