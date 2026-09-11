# SCRUM-251: the soft ceiling

## Problem

The run token ceiling is checked after a step: the call that crosses it
finishes, and the next call is refused. On a seven-account brief the check
read 145.8k after step six, under the 150k ceiling, and step seven then
added 38k, so the run was refused its next call at 184k. Had step seven
been a read rather than the send, the run would have ended one step past
its limit with no report and a silent stop card. The ceiling stops spend;
it does not make a run finish well.

## Change

A run that has used most of its budget is told to close. The threshold is
`RUN_SOFT_CEILING`, 85 percent of `RUN_TOKEN_CEILING`, beside it in
`billing/plans.ts`. Two pieces, reading the same accumulator the ceiling
reads:

- An input processor on the agent, `mastra/soft-ceiling.ts`, runs before
  each model call. On a skill-seeded turn whose run has reached the soft
  ceiling, it appends one closing instruction to the step's messages:
  write the report now from what is already in hand, send it with the one
  send the skill allows, make no other tool calls, start no new reads. A
  run under the line, and an ordinary chat turn, get nothing. The
  instruction is appended once per step and never twice.
- The chat route emits the existing `playground_run_ceiling_hit` event with
  a `reason`: `soft` when a run crosses the line between two steps
  (closing requested), `hard` when the ceiling refuses the next call. Both
  carry the weighted total before the step that crossed and after it, so
  the event says how far past the line a step went.

Scoped to skill-seeded turns: the instruction is written for a run with a
report to send, and an ordinary chat turn stops at twelve steps well
before its budget. Widening it to chat is a text change, not a design
change.

The closing step is not free: on the run above it would have cost about a
step's thinking at the effort in force (SCRUM-248). That is why the line
sits at 85 percent rather than 95: a closing step at today's thinking
sizes is 20k to 40k weighted, and 15 percent of the ceiling is 22.5k. With
`medium` the margin grows.

## Proven and not proven

Proven by test: a skill run at or over the line gets the closing
instruction on its next step, once; a run under it does not; a chat turn
never does; the route emits `soft` with the two totals when a step crosses
the line and `hard` with the two totals when the ceiling refuses a call.
Not proven here: that the model obeys the instruction and closes in one
step on a real run, and that the appended instruction is not persisted
into the thread by the runtime. Both are read off the next real run.
