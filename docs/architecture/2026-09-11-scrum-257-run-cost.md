# SCRUM-257: what a session costs

## Problem

Every model step already reports its tokens to analytics, and the run
ceiling already sums a weighted total per run in process memory. Nothing
stores those totals on our side, nothing prices them, and nothing shows
them to anyone. Answering "what did that run cost" is an analytics query
and hand arithmetic. The ceiling is a token count standing in for money;
the user, and we, should see the money.

## Change

One accumulator, one writer, one price table, two surfaces.

- The run token accumulator (`mastra/run-token-budget.ts`) keeps the full
  buckets per run beside the weighted total it already keeps: uncached
  input, cache read, cache write, output, reasoning, and the step count.
  `runUsage(runId)` returns them. The ceiling and the accounting read the
  same object, so they cannot disagree.
- `gateway/usage/model-prices.ts` is the one price table, keyed by model
  id, USD per million tokens for the four buckets, with the date the
  prices were read. `SELECTABLE_MODELS` lists the models the agent can
  run; a test pins that every one of them, and the configured default,
  has a row, so a model added to the selector without a price fails the
  suite instead of pricing at zero. `costUsd(model, usage)` is the only
  arithmetic.
- `agent_run_usage` (new table, one migration): one row per run, keyed by
  run id, carrying the user, the thread, the skill if any, the model, the
  step count, the five token buckets, the weighted total and the cost in
  USD. The chat route upserts it at the start of each step after the first
  and when the run ends, from `runUsage`, so the row is the accumulator's
  mirror after every step and a viewer who left still gets the final
  numbers. Per-thread accounting is a sum over that thread's runs; there
  is no second ledger. Writes never throw and race a short timeout, the
  same convention as tool metering.
- The end of a run puts one line in the thread: a `run-summary` data part
  with the steps, the tokens and the cost, rendered small and muted under
  the last message, replayed from storage like the other data parts.
- The usage dashboard gains an agent section: period totals (runs, steps,
  tokens, cost) and a table of sessions, each with its runs, from two new
  session-gated routes, `/api/usage/runs` and `/api/usage/sessions`.

For the daily usage report, the per-user per-day rollup is one query over the
table:

```sql
select date_trunc('day', started_at) as day, user_id,
       count(*) as runs, sum(steps) as steps,
       sum(weighted_tokens) as weighted_tokens, sum(cost_usd) as cost_usd
from agent_run_usage
group by 1, 2 order by 1 desc, 2;
```

Deliberately not done: a cost line on a run-ended event, because that
event is SCRUM-255's and does not exist yet; billing anyone for agent
tokens; any change to the ceiling.

## Proven and not proven

Proven by test: the accumulator's buckets and step count per run; the
price table covers every selectable model and the default, and the cost
arithmetic on a known run; the writer's upsert carries every field and
never throws; the route writes after each step and at the end and emits
the summary part before the finish; the two routes answer only the
caller's rows; the summary line renders. Not proven here: a row written by
a real run after deploy, which is the migration plus one run, and the
dashboard section on real data.
