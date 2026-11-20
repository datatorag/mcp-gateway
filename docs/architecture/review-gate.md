# The PR review gate

Every pull request gets a cleanup pass and a defect review before it is pushed, and the proof
that both ran is written by the harness, not by the session that ran them. The two passes are the
repo skills `pr-simplify` and `pr-review`; the gate is `scripts/hooks/review-gate.mjs`, wired in
`.claude/settings.json`.

## What the hooks can see (verified 2026-11-20)

A headless Claude Code session in a throwaway repo, with every hook logging its input, showed:

- **A `Skill` hook** gets `{"skill": "<name>"}` when the skill is loaded. There is no event when
  the work a skill describes is finished, so the gate never treats a load as a completed pass.
- **A `ReportFindings` hook** gets every finding with its `outcome`. That report is the moment a
  pass is done, so the record is written there.
- **A `Bash` hook** gets the command. Exit code 2 stops the call, and its message reaches the
  agent.
- **Subagents:** the same project hooks fire for a subagent's tool calls; a push from a subagent
  was refused like one from the main session.

The tests in `scripts/hooks/review-gate.test.mjs` drive the script with the same inputs.

## The record

A load of `pr-simplify` or `pr-review` notes, per session, which skill is running. The next
findings report appends one JSON line to `<git common dir>/review-records/<branch>.jsonl`. That
directory is outside every work tree and shared by the clone's worktrees.

| Field | Meaning |
|---|---|
| `skill` | `pr-simplify` or `pr-review` |
| `branch` | the branch checked out |
| `tree` | the tree of the work tree at that moment, untracked files included, built in a throwaway index so nothing is staged |
| `head` | the commit checked out |
| `at` | the time |
| `session_id` | the session that ran the pass |
| `findings` | each finding's file, summary, and outcome |
| `open` | how many findings have no outcome of `fixed`, `skipped`, or `no_change_needed` |

A findings report that does not follow a load of one of the two skills writes nothing.

## The push

Before `git push`, `gh pr create`, `gh pr ready`, or the push scripts, the gate needs:

- a `pr-review` record on this branch whose tree is the tree of the commit being pushed, with no
  open finding;
- a `pr-simplify` record on this branch with no open finding.

A pass run before committing counts for the commit of exactly that work, because its tree is the
same. A commit after the review changes the tree, and the push is refused until a re-review: run
`pr-review` on what changed since the recorded tree, which is small.

A push the gate cannot check (no git, a broken repo) is refused. Any other command is never
blocked by the gate failing.

After a push that the remote holds, the gate itself posts the commit status `claude-review` on the
pushed sha through the local `gh` login, to the repository of the `origin` remote, the one it
checked. A command that posts that status, or that touches the
records, is refused, and so is a file write into the records.

## Escape hatches

- **Content, docs, and registry pairs pass by path.** A PR whose every changed file is under
  `apps/gateway/content/`, `docs/`, or a `registry/*.sql` pair needs no review record. The status
  says it was exempt by path. This is a rule in the script, never a choice made in a session.
  The changed files are read against the remote's `main` (through `git ls-remote`), not the local
  `origin/main` ref, which a session could move to make a code branch look like a docs-only one.
- **A pull request opened by hand.** A push from a terminal runs no Claude Code hook, so it posts
  no `claude-review` status. Once `claude-review` is a required check on `main`, such a PR merges
  in one of two ways: run the two skills in a session on the branch and push again from there, or
  merge with the repository admin's override.

## What a session could still do

The gate is a guardrail inside Claude Code, not a sandbox. It cannot stop:

- a push through a form the matcher does not recognize (an alias, a variable holding the command,
  a script that pushes under another name);
- writing the records through an indirection the matcher misses;
- editing `.claude/settings.json` to remove the hooks, or turning hooks off for a run;
- running a skill's load and then a findings report with every finding marked `skipped`, which
  the gate counts as closed. A skip's reason lives in the finding's text, which the gate does not
  judge.

The required `claude-review` check on GitHub is what turns the guardrail into a rule: a PR whose
head has no status cannot merge without the admin override.
