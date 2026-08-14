---
name: pattern-review
description: Review a diff against THIS repo's established patterns before it ships — the repo-aware counterpart to the generic /simplify. Use when a change is written and you want it checked for pattern drift, duplicated sources of truth, and copies that diverged from the sibling they were pasted from. Runs a deterministic check first, reserves the model for judgement, proposes rather than rewrites, and can return a clean verdict.
---

# Pattern Review

The bundled `/simplify` reviews a diff for reuse, simplification, efficiency and
altitude. It is good and it knows nothing about this codebase. This skill is the
half it cannot supply: what OUR layering is, where things belong here, and the
specific ways code generated against this repo has drifted from it before.

**It does not restate the architecture.** `codebase-map` and `gateway-dev` own
that, and a second copy here would drift from them — which is the exact defect
this skill exists to find. Load them; this file only tells you what to DO with
them.

## Relationship to the design-time check

`codebase-map` has a "Quality pass — design-time, not post-hoc" section ruling
that agent fan-out review does **not** run on every change by default, and
giving four questions to answer inline *before* implementing instead. That rule
stands and this skill does not compete with it:

- **Before writing code** → answer those four questions inline. Cheaper, and it
  shapes the code instead of criticising it.
- **After a diff exists**, on request or before a substantial push → this skill.
  One pass, scoped to the diff, no four-agent fan-out.

If you find yourself running this on every two-line edit, the design-time check
is the one you skipped.

## The failure mode this repo actually has

Not "the code is too complicated". Every quality pass in this repo's history
converged on one mechanism: **new code is started by copying the nearest sibling,
and the copy and the original then diverge.** From the log:

- `cf5cb4f` — the playground had hand-copied the tool-visibility policy from
  `mcp-server.ts`, and the copy had **silently dropped a branch** the original
  had (`DOCKER_HOST_OVERRIDE`). Nothing failed; one environment was just wrong.
- `7c168ff` — the Agent route copy-pasted the accounts fetch from the dashboard,
  and the two **diverged inside the same branch**: one grew a refetch the other
  did not, so the same user saw a connected account on one screen and not the
  other.
- `7911d23` — the home page carried a hardcoded connector list parallel to the
  docs frontmatter that had **already drifted** from it.
- `4bcd6ee` — the 401 challenge and the discovery router each spelled the same
  path, free to drift apart.
- `28f723c` — a hand-written interface asserted over a vendor's, so `tsc` could
  not see a signature mismatch. Delete silently deleted nothing and reported
  success.

So the highest-yield question is not "can this be shorter". It is:

> **What was this pasted from, and what does the original do that this does not?**

That question is invisible to a reviewer looking only at the diff, because the
divergence lives in a file the diff does not touch. Reading the sibling is the
whole technique.

## How to run it

### 1. Scope to the diff. Always.

```bash
node scripts/pattern-check.mjs origin/main...HEAD   # default
node scripts/pattern-check.mjs --staged             # about to commit
node scripts/pattern-check.mjs --working            # uncommitted, incl. new files
```

A pass that reviews the whole repo is a pass nobody runs. If the diff is more
than ~15 files, review the files that carry behaviour and say in the report
which ones you did not read — a silent cap reads as coverage.

### 2. Mechanical first, and never re-derive what it already answered.

`scripts/pattern-check.mjs` owns the rules with exactly one right answer:
extensionless relative imports, `process.env` reads that duplicate the zod env
schema, client-IP ordering behind Cloudflare, the `createDb()` singleton, and
the `withRoute` wrapper on session-gated API routes. Each is self-tested against
a known-bad and a known-good string before it runs, so a matcher that has gone
blind exits 2 instead of reporting clean.

Exit codes mean different things and must not be collapsed: **0** clean, **1**
findings, **2** the check itself is broken.

Do not ask the model to look for those five things. It is slower, costs tokens,
and can be talked out of a correct grep.

### 3. Then the judgement half — four lenses, in this order.

Only now open the diff. The four questions are the ones in `codebase-map`'s
quality-pass section (reuse, source of truth, altitude, efficiency); what
follows is how they land *here*.

**Reuse — read the sibling, not just the diff.** For each new module, route,
component or handler, name what it was modelled on and open that file. Compare
behaviour, not shape. The failures above were all shape-matched copies with
different semantics. Specific places a near-match already exists:
`src/lib/with-route.ts`, `src/gateway/user-tools.ts`, `src/lib/token-liveness.ts`,
`src/gateway/usage/`. `codebase-map`'s "Where things live" table is the index —
grep it before concluding nothing exists.

**Source of truth — is this value now written down twice?** The repo's own
answer is almost always "read it from where it already lives": the env schema,
the docs frontmatter, the DB registry, the vendor's exported types. A hardcoded
copy of something derivable is a finding even when both copies currently agree —
agreeing today is what makes the drift invisible later.

**Altitude — is this a special case bolted onto shared infrastructure?** If the
same problem exists for sibling routes or tools, the fix belongs in the shared
layer once. The counter-check matters as much: a change that pushes a *new*
special case into an already-shared branch is the same finding pointing the
other way. `codebase-map` records one branch that caused two production defects
by growing, and says explicitly to stop if you are adding a third thing to it.

**Efficiency — only where it is hot.** Per-request, per-tool-call, or per-item
work. This repo has real instances: a double serialization on every agent tool
call, a hot-path write that ran on every successful MCP call. A micro-optimisation
somewhere cold is noise and spends the reader's attention on nothing.

### 4. Check the finding before you report it.

A review gate can be confidently wrong, and this repo has been burned by acting
on one. Before writing a finding down: open the file, and state the evidence in
the finding itself. If the claim is "X duplicates Y", the finding must name Y.

**Some duplication here is load-bearing and documented.** `codebase-map` carries
an explicit list of things that look simplifiable and must not be simplified —
the shell-height measurement, the full-height branch, `overflow-x: clip` over
`hidden`. It also records a case where documentation preserved a bug as an
invariant, so "the map says don't" is a reason to read the reasoning, not a
reason to stop thinking. If you believe one of those is genuinely wrong, that is
a finding worth raising — with the mechanism traced, not asserted.

Deduplication is also not automatically right. There is a precedent in this
codebase's history of a shared helper being **deliberately not extracted**
because forcing shared code would have cost one caller an extra API round trip.
"These two functions look alike" is not a finding. "These two functions must
agree and nothing makes them" is.

### 5. Report. Do not rewrite.

Propose; let the author apply. The bundled `/simplify` applies fixes itself —
this one deliberately does not, because a diff the author has not read is a diff
nobody has read. Apply only if asked, and then only the findings named.

## Verdict format

Mirror the security gate's shape, so both gates in the ship ritual read alike.

```
PATTERN REVIEW: CLEAN
Scope: <range>, <n> files read, <m> skipped (<why>).
Mechanical: 0 findings across <k> rules.
Judgement: no reuse/source-of-truth/altitude/efficiency findings.
```

or

```
PATTERN REVIEW: <n> FINDINGS
Scope: <range>, <n> files read, <m> skipped (<why>).

[mechanical] <file:line> — <rule id>
  <what and the fix>

[judgement · reuse] <file:line>
  <what> — compared against <the sibling>, which <does X this does not>.
  Suggested: <change>. Cost of not doing it: <consequence>.
```

**CLEAN must be reachable, and it must carry its scope.** A reviewer that always
finds something trains people to ignore it — the finding that matters then
arrives in a stream of noise. If the diff is fine, say it is fine. And say it
about the diff you actually read: "clean" phrased without a scope gets forwarded
as an all-clear about the change as a whole, which is a claim this skill has not
made. Nothing here checks correctness, security, or whether the thing works —
`/code-review`, the `security-reviewer` agent and the test suite do those.

## When a finding keeps coming back, graduate it

A rule you have reported twice should stop being a judgement call. Two places to
put it, in preference order:

1. **A rule in `scripts/pattern-check.mjs`** — if it is greppable on a diff.
   Give it a `selfTest` with a known-bad and known-good string, or it can go
   blind and read as protection.
2. **A structural guard test**, alongside the five that already exist
   (`route-session-checks`, `shell-invariants`, `content-frontmatter`,
   `tool-count-claims`, `security-headers`). These are the repo's real
   deterministic layer — read `route-session-checks.test.ts` first, it is the
   model: it WALKS the directory rather than listing files, defaults to
   failing, keeps exemptions in code with a reason, strips comments before
   matching so a file cannot satisfy the guard with prose about the guard, and
   asserts its own detector still rejects a known-bad string.

Do not add a rule to `pattern-check.mjs` that one of those five tests already
covers. Two authorities that can disagree is the durable defect, even when the
pick happens to be right.

**There is no ESLint in this repo and `pnpm lint` runs zero tasks** — it exits 0
having executed nothing. So "add a lint rule" is not the cheap option here that
it is elsewhere; a guard test is. If you propose introducing a linter, propose it
as its own piece of work, not as a side effect of a review.

## Rules deliberately NOT mechanical

Recorded so nobody re-proposes them, and because the measurement is the argument.

- **Date parsing** (`new Date(\`${d}T00:00:00\`)` for `YYYY-MM-DD` frontmatter).
  A grep for `new Date(` returns 9 hits today and **all 9 are correct** — sorting
  comparisons where a uniform timezone shift cannot change the order, and ISO
  timestamps that carry a time. The rule is real but its boundary is semantic,
  and a check that is wrong nine times out of nine gets switched off in a week.
  It stays a judgement lens.
- **Built-in tool dispatch via the registry** rather than an inline
  `if (name === ...)`. Correct, and it needs to understand dispatch structure;
  as a regex it would fire on unrelated string comparisons.
- **Never-throw side channels.** Whether a `catch` is genuinely exhaustive is not
  a grep. It stays a lens.

## Blind spots, stated so a clean result is not over-read

- The mechanical rules see **changed lines and changed files**. A change that
  breaks a pattern by editing something the diff does not touch is invisible.
- The comment-stripper is a regex, not a lexer. It is biased toward rejecting,
  and its threat model is omission — someone forgot — not evasion.
- Nothing here runs the code. Tests, typecheck and build are separate and still
  required.

## Where this sits in the ship ritual

`gateway-dev` owns the ritual. This is a quality gate, not a security one, and
the security gate stays mandatory and unchanged. If you run this, run it **before**
the security review, so any code you move has been re-read for leaks by the gate
that is actually looking for them.
