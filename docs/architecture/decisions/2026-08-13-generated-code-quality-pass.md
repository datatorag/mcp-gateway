# Keeping generated code on this repo's patterns

- **Date:** 2026-08-13
- **Who:** proposed by the product session; the automation half needs a decision
- **Status:** proposed — the skill is built and tested; **no hook is wired**
- **Log line:** Repo-aware pattern review ships as an invoked skill; only the deterministic half is proposed for automation, beside the existing pre-push gate.

## Context

Most code here is now written by an agent. The generic `/simplify` reviews a
diff for reuse, simplification, efficiency and altitude, and it knows nothing
about this codebase — so it cannot see the drift that actually happens here.

**The drift has one dominant mechanism, and the log is unambiguous about it.**
New code is started by copying the nearest sibling, and the copy and the
original then diverge:

| Commit | What had happened |
|---|---|
| `cf5cb4f` | The playground had hand-copied the tool-visibility policy from `mcp-server.ts`; the copy had silently dropped a `DOCKER_HOST_OVERRIDE` branch. Nothing failed — one environment was just wrong. |
| `7c168ff` | The Agent route copy-pasted the accounts fetch from the dashboard. The two diverged *inside the same branch*: one grew a refetch the other did not, so the same user saw a connected account on one screen and not the other. |
| `7911d23` | The home page carried a hardcoded connector list parallel to the docs frontmatter that had already drifted from it. |
| `4bcd6ee` | The 401 challenge and the discovery router each spelled the same path, free to drift. |
| `28f723c` | A hand-written interface asserted over a vendor's, so `tsc` could not see a signature mismatch. Delete deleted nothing and reported success. |

The divergence lives in a file the diff does not touch, which is why reviewing
the diff alone misses it. That is the gap: not "a simplify pass", but a
simplify pass that knows what this code was pasted from.

Two facts constrain any automation proposed here:

- **There is no CI in this repo.** No workflows, no hooks, no pipeline. Every
  check runs only when a person or an agent types the command.
- **`pnpm lint` runs zero tasks.** No package defines a `lint` script and there
  is no ESLint, Biome or Prettier anywhere in the tree; `turbo run lint` exits 0
  reporting "No tasks were executed as part of this run." So "just add a lint
  rule" is not the cheap option here that it is in most repos. The repo's real
  deterministic layer is its five structural guard tests.

## Alternatives considered

Every one of these would catch real problems. That is not the question. The
question is **which one still exists in a month**, so each is judged on its
failure mode.

### A. `PostToolUse` hook on `Write|Edit`

Incremental, fires while context is hot, catches drift at the moment it is
written.

**Failure mode — it is wrong about the change, not just expensive.** At
`Write`/`Edit` time the change is half-built: the helper about to be extracted
does not exist yet, the sibling has not been updated yet, the test lands two
edits later. Findings generated then are correct about the file and wrong about
the change, and they arrive while the author is mid-thought. A warning that is
confidently wrong does not fail loudly — it quietly stops someone doing
something safe, and it is the shape people learn to dismiss fastest.

Second, the unit is wrong. This repo's signature defect needs the diff *and* the
sibling; a hook that sees one file post-write cannot ask "what was this pasted
from". Third, cost: a model pass per edit, unbatched, is the most expensive
option by a wide margin — a 40-edit session is 40 passes.

### B. Pre-commit hook

Batches the whole change; a natural review point.

**Two distinct failure modes, and the second is the one that decides it.**

1. **A slow commit hook gets disabled within a week.** A model pass on every
   commit is slow, and commits here are frequently work-in-progress — blocking
   them punishes the wrong moment. `--no-verify` becomes reflex, and a gate
   people habitually bypass is worse than none, because it still reads as
   coverage.
2. **A `.git/hooks` hook protects exactly one machine.** Git hooks are not
   copied by clone. It would not survive a fresh checkout, a second machine, a
   worktree, or a cloud/background agent — while reading, to everyone, like the
   repo is covered. Prefer a guard that travels with the repo over one that
   lives on a machine.

Worth separating clearly, because "pre-commit hook" hides two different things:
a **`.claude/settings.json` hook is checked in and does travel with the repo**; a
`.git/hooks/pre-commit` does not. Only the former is even a candidate.

### C. Fold into the existing pre-push security gate

The gate already exists: the `security-reviewer` agent runs on `origin/main...HEAD`
before every push, is mandatory in `CLAUDE.md`, is step 4 of the ship ritual in
`gateway-dev`, and already returns a PASS/BLOCK verdict. Adding a quality pass
beside an accepted gate is the cheapest place to put one, and push is the moment
the change is finished and about to become public.

**Failure mode — dilution, and lateness.** The security gate's authority comes
from being about one thing; the security-reviewer is explicitly told not to flag
style, performance or non-security bugs. If a quality finding can BLOCK a push,
the combined gate starts crying wolf about things that are not dangerous, and
the response is to stop reading it — taking the security half down with it. That
is a real cost, not a hypothetical one: the finding that matters arrives inside
a stream of noise.

Also, push is late. A structural finding at push time means rework of finished
work, which is exactly when it is least likely to be acted on.

Both are containable — quality findings must be advisory, never blocking, with
their own verdict vocabulary — but only if that separation is designed in rather
than assumed.

### D. Manual invocation only

The honest baseline, and in this repo it is a stronger baseline than usual:
voluntary quality passes already have a track record here. `7911d23`, `5078fb2`,
`cf5cb4f`, `4bcd6ee`, `57a13bf`, `7c168ff` are all quality passes somebody chose
to run, and each landed real fixes. Whatever automation is proposed has to beat
a practice that demonstrably already happens.

**Failure mode:** zero coverage exactly when someone is rushing, which is when
drift is most likely. It relies on remembering, and nothing reminds you.

## Decision

**Proposed, and split by cost — because the two halves of this review have
completely different economics.**

1. **The judgement half ships as an invoked skill and is NOT automated.**
   `.claude/skills/pattern-review/SKILL.md`. It consumes `codebase-map` and
   `gateway-dev` rather than restating them, is scoped to the diff, proposes
   rather than rewrites, and can return CLEAN. This is option D, matching the
   practice that already works.

2. **The mechanical half — `scripts/pattern-check.mjs` — is the only part
   proposed for automation, and it goes beside the pre-push gate.** It is a
   deterministic diff-scoped check: no model, no network, **~0.55s** on a
   seven-file range. It cannot hallucinate, and all five of its rules are
   mutation-proven to fire on a known-bad string and stay silent on a known-good
   one. That is cheap enough to run automatically and specific enough not to cry
   wolf.

3. **No hook is wired.** The exact wiring is written down and ready to apply in
   `docs/architecture/pattern-check-hook-wiring.md`, pending a decision.

The load-bearing reason for the split: **automate the check that cannot be
wrong, invoke the one that can.** A deterministic grep that exits 0/1/2 has no
false-positive budget to spend, so automating it costs nothing in credibility.
A model pass has a real false-positive rate, and every false finding it produces
is drawn from the same trust account the security gate spends from.

Corollaries that are part of the decision, not implementation detail:

- **Quality findings never block a push.** Advisory only, separate verdict
  vocabulary from the security gate's PASS/BLOCK.
- **Never auto-apply.** The bundled `/simplify` applies its own fixes; this one
  does not. A diff the author has not read is a diff nobody has read.
- **CLEAN must be reachable and must name its scope.** A reviewer that always
  finds something trains people to ignore it.
- **A recurring finding graduates** into a `pattern-check.mjs` rule, or into a
  structural guard test beside the existing five — not into a longer skill.

## Consequences

**What this commits us to.** A second file that can go stale: `pattern-check.mjs`
encodes patterns that `codebase-map` documents. It is written to read the env
schema from `packages/config` rather than copy it, and it deliberately does not
duplicate any of the five existing guard tests, but the freshness rule now
covers it — a change that alters one of its five rules updates it in the same
commit.

**What it makes harder.** Nothing is enforced. If the skill is not invoked, no
judgement review happens, and the only automatic coverage is whatever hook gets
approved. That is the accepted cost of not spending the security gate's
credibility, and it should be revisited with evidence rather than defended.

**What would trigger revisiting:**

- The skill is not actually being invoked. Then automation is worth its cost and
  option C — advisory, non-blocking, mechanical-only first — is next.
- A `pattern-check.mjs` rule produces a false positive anyone waves through.
  That rule comes out immediately; one waved-through finding is how a check
  starts being ignored wholesale.
- The judgement lenses keep surfacing the same finding. It should have graduated
  to a deterministic rule and did not.
- Someone introduces a linter. Then several judgement lenses move down a tier,
  and this decision should be re-cut around it.

## Appendix: what the skill found on a real diff

Run against `ea8a9fd` (thread list, 530 insertions across 7 files).

- **Mechanical: clean**, 5 rules, 7 files.
- **Judgement, reuse — live at HEAD.** `ThreadList` in
  `apps/gateway/src/app/dashboard/agent/thread-list.tsx` re-implements the
  client-side dashboard-API fetch that `app/dashboard/use-connections.ts`
  already owns — the hook that exists *specifically because* two copies of that
  fetch diverged (`7c168ff`). The re-implementation drops the property that hook
  was fixed to have: `use-connections` logs a status-only breadcrumb on failure,
  with a comment recording that a silent catch previously turned a transient
  failure into a rollback and a manual production diagnosis. Both of
  `ThreadList`'s catch blocks are silent — no `console.warn`, no `[module]`
  prefix — against a documented never-throw-and-warn convention. Same surface,
  same failure mode, fix not carried across.
- **Judgement, source of truth — live at HEAD, lower confidence.**
  `relativeTime`'s fallback formats with `{ month: "short", day: "numeric" }` and
  no year, so a conversation from last August renders identically to one from
  this August. `lib/utils.ts` already exports a shared date formatter that
  includes the year.

Reported, not fixed — they are outside this branch's scope.

Run against `6d3cf9f` (digest fix, 2 files) the verdict was **CLEAN** on both
halves, which is the result that matters most: the pass is only worth having if
it can say a diff is fine.
