---
name: pr-review
description: The defect review every PR to this repo gets before it is pushed. Runs the generic code review on the PR's diff, then this repo's own checklist (a tool is four things that move together, an outside API is unproven until a live call, errors name the real cause, limits that grow with the answer), verifies each finding against the code, fixes or explains it, and ends with a findings report the push gate reads. Use before every push to a PR branch and before `gh pr create`; pair with pr-simplify.
---

<!--
Reuse by reference, not by copy. This skill tells you to run the generic
code review's steps, then adds this repo's checklist. A copy of the generic
steps would stop tracking them the day they change; a reference keeps working.
What lives here is only the repo-specific checklist and the report the gate
requires.
-->

# PR Review

The defect half of the pre-push pass. `pr-simplify` is the cleanup half. Both
run on every PR, and the push gate checks that this one ran on the exact tree
being pushed (see "The report" at the end).

This is not the security gate. The `security-reviewer` agent still runs on
every push (`CLAUDE.md`); this review looks for defects, not for leaks.

## Scope

The diff `origin/main...HEAD`, plus any uncommitted changes (`git diff HEAD`).
The gate compares the tree this review saw with the tree being pushed, so any
commit after the report needs a new review. Make it cheap: review only what
changed since the tree the last report recorded, and send a new report.

## Steps

1. **Run the generic code review's steps** on that scope: find defects, verify
   each against the code, keep only what survives. Load the generic
   `code-review` skill when it is available and follow it; do not restate it.
2. **Run the checklist below**, every section, against the same diff.
3. **Verify every finding against the code** before acting on it. A pattern
   match is a candidate, not a finding: read the code under test and say how
   the failure is reached. A finding that cannot be reached is
   `no_change_needed`, with the reason.
4. **Fix** each confirmed defect, with a test that fails without the fix where
   one can be written. Skip only with a reason a reader can check.
5. **Re-run** the tests the change touches and the gate.
6. **Send the report** (last section).

## This repo's checklist

### A tool is four things that move together

A plugin tool is its handler, its description and schema, its docs page, and its
runner case. A diff that changes one and not the others is a finding:

- **Description or schema changed:** that is a registry row. The PR says the
  row pair will be generated after merge (`pnpm registry:diff`), and names the
  deploy order when the gateway would refuse a new argument until the row is in.
- **Behavior changed:** the docs page and the changelog entry say the same
  thing as the code, including limits and what is left out by default.
- **A new tool:** its write or read classification (registry snapshot, known
  reads), its send-guard rule (a new write is refused until it has one), its
  public status title, and a runner case in its service's scenario. A tool that
  takes a file is in `FILE_CONSUMING_TOOLS` and goes through the file handoff.
- **A runner case changed:** its own input is sent to the real API on a test
  account before the PR is reported, or the PR says it cannot be until deploy.

### An outside API is unproven until a live call says so

Tests against a stub prove the code does what the stub expects, nothing more.

- **Name what has only run against a stub,** in the PR body, as a list.
- **Ask what a plan, a scope, or a size changes.** A free plan where the API
  needs a paid one; a scope the grant does not hold; a list longer than one
  page or one batch; a request shape the reference shows one way and the API
  wants another (a single filter where the API wants a combinator). Each is a
  question the stub cannot answer; say which were checked live.
- **A request body written from a reference,** not from a recorded answer, is
  marked as such in the fixture and the PR.

### Do not fetch what was not asked for

- Data that costs a request per item (names per attendee, a read per row, a
  download per file) is opt-in, the way a transcript or a full body is.
- A lookup that must stay is capped, the cap is in the description, and an item
  past the cap is counted, not dropped silently.
- An answer never puts an id where a name is expected; something that cannot be
  named is counted or labeled as an id.

### An error sentence names the real cause

- A refusal from an outside API is told apart by its own message or code, and
  each known case gets its own sentence. It is never folded into the nearest
  known case: a 400 for the request's shape is the connector's fault, not the
  user's workspace.
- Words that blame the user's account, plan, or data are used only when the
  API's answer says so; the API's own message follows ours.
- A line built from the answer of a call that already ran (a hint, a summary)
  never turns that call's success into an error.

### Inputs and outputs a stranger controls

- Lookups on a plain object with a caller-supplied key use own-property checks
  (`Object.hasOwn` or a `Map`): `constructor` and `__proto__` are keys, not
  rules.
- Text from a stranger is escaped for where it goes: Slack (`slackField`),
  HTML email (`escapeHtml`), and kept on one line where a newline could forge a
  field.
- An id put into a request path is validated (`notionId()`, the method table),
  and comes from the provider's own answer or a checked argument.
- Anything logged prints a message, not an error object that may carry query
  values.

### Copy, in code and in content

- The serial comma; "agent", never "assistant"; American spelling; no em or en
  dashes in added text.
- Nothing from the company's private records in a public file: no customer, no
  counts, no internal ids. The rule, never the evidence.
- A claim in copy matches the code it describes, including what is off by
  default and what a plan does not allow.

## The report

End by calling the `ReportFindings` tool exactly once, with every finding and an
`outcome` on each:

- `fixed`: changed in this review.
- `skipped`: left as it is; `summary` or `failure_scenario` says why.
- `no_change_needed`: the finding did not hold against the code.

Send an empty `findings` list when there were none. Put `pr-review` in each
finding's `category` prefix (for example `pr-review:four-things`), so the record
says which pass it came from.

**This report is how the push gate knows the review ran.** A hook records it
with the tree it described. A push needs a `pr-review` record whose tree equals
the tree being pushed, and a finding left without an outcome blocks the push.
