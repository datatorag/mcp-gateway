---
name: pr-simplify
description: The cleanup pass every PR to this repo gets before it is pushed. Runs the generic /simplify on the PR's diff, then this repo's own cleanup checklist (the helpers that already exist, where code belongs, lookups that grow with the answer), applies the fixes, and ends with a findings report the push gate reads. Use before every push to a PR branch and before `gh pr create`; pair with pr-review.
---

<!--
Reuse by reference, not by copy. This skill tells you to run the generic
`simplify` skill's phases and the repo's `pattern-review` skill, then adds what
neither knows. A copy of their steps would stop tracking them the day either
changes; a reference keeps working. What lives here is only the repo-specific
checklist and the report the gate requires.
-->

# PR Simplify

The cleanup half of the pre-push pass. `pr-review` is the defect half. Both run
on every PR, and the push gate checks that both ran on the exact tree being
pushed (see "The report" at the end).

## Scope

The diff `origin/main...HEAD`, plus any uncommitted changes (`git diff HEAD`).
After a fix, the tree changes, so the report you send describes the tree as it
stands when you send it. A commit made after the report needs a new pass, and
that pass is cheap: review only what changed since the tree the last report
recorded.

## Steps

1. **Run the generic `simplify` steps** on that scope: gather the diff, the four
   angles in parallel (reuse, simplification, efficiency, altitude), dedup the
   findings. Load the `simplify` skill and follow it; do not restate it.
2. **Run this repo's deterministic check:** `node scripts/pattern-check.mjs
   origin/main...HEAD` (and `--working` for uncommitted files), then
   `pattern-review`'s four lenses. Load `pattern-review` for how; its rules on
   checking a finding before reporting it apply here too.
3. **Run the checklist below** against the same diff, as a fifth angle.
4. **Apply the fixes** that survive a check against the code. Unlike
   `pattern-review`, this pass edits: it is the last cleanup before the push.
   Skip a fix only when it would change intended behavior, needs changes well
   outside the diff, or is a false positive, and give that reason.
5. **Re-run the tests** the changed files touch, then the gate, before the
   report: a cleanup that breaks a test is not a fix.
6. **Send the report** (last section).

## This repo's cleanup checklist

Each is something a review of this codebase has found more than once.

**Reuse what exists; never make a third copy.**
- Joining a list in prose: `listOf` (`apps/gateway/src/lib/list-of.ts`), which
  writes the serial comma.
- Text a stranger supplied, on its way to Slack: `slackEscape` and `slackField`
  (`apps/gateway/src/lib/slack-text.ts`). In an email: the module's
  `escapeHtml`, and a name or other free text checked before it is used as a
  greeting or a label.
- A file a tool takes: the file handoff (`FILE_CONSUMING_TOOLS`, the plugin's
  `/internal/consume` and `handoff.ts`), never bytes in a tool argument.
- A Notion id or URL: `notionId()`; a Google API call: the method table and
  `client.api`; a not-found answer: `notFoundAnswer`.
- Test scaffolds: one mock set per route or module. A second file with the same
  `vi.mock` block and request builder is a finding; merge the cases.
- Two functions with the same name and body in two modules is a finding even
  when each has its own test.

**One source of truth.**
- A sentence on more than one page is built from shared constants
  (`lib/site-faq.ts`, `lib/public-integrations.ts`), never retyped.
- A list of services, clients, or tools comes from its registry or constant,
  not typed by hand in copy.
- A rule kept in two places (a schema default and an insert fallback, a
  constant and a test literal) is kept in one.

**Altitude.**
- A special case for one tool in a shared helper belongs on that tool's own
  entry or at its own dispatch point.
- Text added to an answer is added at one place, and every reader that parses
  the answer goes through one helper that knows about it.

**Efficiency.**
- A lookup that multiplies with the size of the answer (one call per attendee,
  per row, per file) is opt-in or capped, the cap is stated in the tool's
  description, and the results are cached across the items of one call.
- Independent requests run concurrently with a small, stated limit, not one
  after another.
- A read whose result is thrown away when a feature is off (analytics, a
  disabled path) is not made.

**Simplification.**
- Dead `required` entries, unused exports, a default stated twice, a test that
  only restates a constant.

## The report

End by calling the `ReportFindings` tool exactly once, with every finding from
steps 1 to 3 and an `outcome` on each:

- `fixed`: changed in this pass.
- `skipped`: left as it is; `summary` or `failure_scenario` says why.
- `no_change_needed`: the finding did not hold against the code.

Send an empty `findings` list when there were none. Put `pr-simplify` in each
finding's `category` prefix (for example `pr-simplify:reuse`), so the record
says which pass it came from.

**This report is how the push gate knows this pass ran.** A hook records it with
the tree it described. A push needs a `pr-simplify` record on the branch, and a
finding left without an outcome blocks the push.
