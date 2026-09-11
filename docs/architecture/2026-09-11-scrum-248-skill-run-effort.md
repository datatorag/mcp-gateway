# SCRUM-248: a thinking effort for skill runs

## Problem

On a seven-account brief, thinking is the dominant cost of every step after
the first. Measured on a run from 2026-09-11 through the generation
telemetry's reasoning count: the seven steps produced 2.8k, 1.4k, 1.0k,
12.6k, 17.2k, 18.3k and 19.6k output tokens, of which 0.5k, 1.1k, 0.7k,
12.2k, 16.3k, 14.7k and 12.7k were thinking. Thinking was 58k of the 73k
output tokens, and the four long steps each ran two to three minutes. That
is what starved the browser's stream (SCRUM-254) and what carried the run
past its ceiling one step after the check (SCRUM-251).

## What the provider exposes

The playground model (claude-sonnet-5) does not accept a token budget for
thinking. Probed against the Messages API: `thinking.type: "enabled"` with
`budget_tokens` returns a 400 saying the type is not supported for this
model and to use `thinking.type: "adaptive"` with `output_config.effort`.
The provider documentation confirms it: models from Opus 4.7 on, Sonnet 5
included, reject `enabled`; the depth control is `effort`, one of `low`,
`medium`, `high`, `xhigh`, `max`; and even where `budget_tokens` exists it is
"a target rather than a strict cap". With adaptive thinking the model
"decides whether and how much to think on each request, and at lower effort
settings it may skip thinking entirely on easy inputs".

Today's production request carries no thinking field at all. On this model
that resolves to adaptive thinking at the API default, `effort: "high"`:
the documentation states that `effort: "high"` matches the default and that
omitting it produces identical behaviour. So the 12k to 20k thinking per
step above is the `high` baseline.

The SDK in use (`@ai-sdk/anthropic`) sends `effort` as
`providerOptions.anthropic.effort` and maps the API's
`output_tokens_details.thinking_tokens` into `usage.outputTokens.reasoning`.
The generation telemetry already records that as `$ai_reasoning_tokens` per
step; the numbers above were read from it.

## The arithmetic behind the level

Had a token cap existed, the level would have been chosen so the same run
ends under the ceiling with its closing report. Thinking does not re-enter
the next step as cache-written input on this run (the step after a 12.6k
output step wrote 5.0k), so a cap acts on output only. The run weighed
184.1k against the 150k ceiling. Capping thinking at 8k per step would have
left it at 164.9k; at 6k, 152.2k, still over; at 5k, 148.2k; at 4k,
144.2k. A 5k-per-step equivalent is therefore the target that the chosen
effort is judged against on the next real run: if `medium` lands the
thinking steps near 5k, the run ends at about 148k with its report.

`medium` rather than `low` because it is the reversible first step: nobody
has seen a brief written at `low`, and the proof run after deploy compares
the brief's content against today's. SCRUM-251's soft ceiling is the
backstop if `medium` is not enough.

## Change

- `SKILL_RUN_EFFORT = "medium"` beside `RUN_TOKEN_CEILING` in
  `billing/plans.ts`: one constant, ruled, next to the ceiling it protects.
- `mastra/run-effort.ts` turns a skill into provider options:
  `{ anthropic: { thinking: { type: "adaptive" }, effort } }`, the effort
  being the skill's frontmatter `effort` (`low`, `medium` or `high`) when
  present and valid, else the constant.
- The chat route passes those options on a skill-seeded turn only (the
  turn the `SKILL_RUN_CONTEXT_KEY` path already recognises). An ordinary
  chat turn carries no thinking setting and keeps today's shape.
- `lib/skills.ts` parses `effort` from frontmatter into the skill. It is
  not part of the content hash, so no published skill's version moves. No
  published skill carries an override in this ticket.
- `mastra/run-token-budget.ts` accumulates the reasoning part of each
  step's output per run beside the weighted total, so the ceiling's own
  usage object can split thinking from visible output.

A thinking configuration is part of the cached prefix, so a skill run and a
chat turn now warm separate copies of the system prompt and tool schemas.
Within a run every step carries the same setting, so the run's own cache
holds; the cost is one extra prefix write per configuration per cache
lifetime.

## Proven and not proven

Proven by test: a skill run's generation options carry adaptive thinking at
`medium`; a chat turn's carry nothing; a frontmatter override wins over the
constant and an invalid value falls back to it; no published skill
overrides; reasoning tokens accumulate per run in the ceiling's usage
object. Not proven here: what `medium` does to thinking per step and to the
brief's content on a real seven-account run. That is the proof run after
deploy, read from `$ai_reasoning_tokens` per step against the 5k target.
