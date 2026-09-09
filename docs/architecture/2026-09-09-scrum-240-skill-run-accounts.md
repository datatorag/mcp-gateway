# SCRUM-240: a skill run knows its accounts and never asks

The first morning-brief run after the ceiling fix got through four tool
calls and then stopped to ask which accounts to cover and in what order.
The skill said "list the accounts to cover at the top of the run" and "the
recipient is the first address in the account list", and the model read
that as a question for the user. A run must never ask (the no-gates
ruling), and a scheduled run would have stalled with nobody to answer.

## The rule

A skill run is handed its accounts. The run message names every connected
account of each service the skill needs, marks the default, and says the
rule in one sentence: cover every listed account, the recipient is the
default of the first service, a subset only if this message names one, and
do not ask. The multi-account skills state the same default in their own
text, so a reader who pastes the skill into another client gets the same
behaviour with no question.

## Where it lives

- `skillRunMessage(skill, accounts)` in `src/lib/skills.ts` composes the
  message. With no accounts it says so and tells the run to stop and say
  that nothing is connected, which is the one case a run may end without
  doing the work. The three surfaces that seed a run all pass the user's
  accounts: the dashboard deep link (`agent/page.tsx`), the scheduler's
  engine (`skills/engine.ts`), and the MCP prompt (`skillApplyText`).
- The chat route's exact-message check recomputes the message from the same
  user's accounts, so byte-for-byte still holds. If the user connects an
  account between loading the page and submitting, the texts differ and the
  turn runs as an ordinary gated turn; that is the safe side.
- The published multi-account skills (morning brief, inbox triage, week
  ahead, weekly capture) replace "list the accounts to cover" with the
  deterministic default.

## Tests

- `skillRunMessage` with two accounts of one service names both, marks the
  default, and carries the no-question sentence; with none it carries the
  stop sentence.
- The chat route recognises the account-bearing message as a skill run for
  a user with those accounts, and not for a user whose accounts differ.
- Each multi-account skill's text contains the default rule and no sentence
  that asks the user which accounts to cover.
