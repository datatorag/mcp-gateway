# SCRUM-167 — the Tasks container gap and the CLI identity hole

Branch: `feature/scrum-167-tasks-and-cli-guard`, from `main` at `f8e8e48`.

Accounts are written as `<shell-account>` and `<mcp-account>` throughout. They
are two different real Google accounts on one machine; which ones does not
matter to the finding and this repository is public.

## What I refused

**1. I did not report `src/gws-client.ts` as already safe, and I did not guard
it either.** The brief expected it to be safe because "the MCP tools take an
`account` param". They do not. No tool in this repository has an `account`
parameter — `grep -rn account src` returns two unrelated hits, an OAuth URL
pattern and a comment. The `account` parameter visible on the hosted tool
schemas belongs to the gateway that wraps this server, not to this server.

The path turns out to be safe anyway in the mode that matters, for a different
reason, and to carry a residual in the other mode. Both are set out under
*Task 3(b)* below. Reporting "safe" on a false premise and reporting "safe"
on a true one look identical in a summary, which is the entire reason this
paragraph exists.

**2. I did not fix that residual.** It is a behaviour change to how the server
resolves identity, it has no observed failure behind it, and bundling it into
a guard fix would put two changes in one deploy. It is written up as a scope
decision, not silently patched.

**3. I did not add a delete-tasklist tool**, and there is now a test that
fails if someone adds one to tidy up the CRUD.

**4. I did not build the other missing tools I found.** They are listed at the
end for HQ to decide on.

---

## Task 1 — `tasks_create_tasklist`

One tool added. `tasks` goes from 6 to 7, the total from 64 to 65, and the
existing count tests forced both README rows and `CLAUDE.md` to move with it.

The only judgement call in the handler is a blank-title check, and it is there
because of what the live API does:

```
$ gws tasks tasklists insert --json '{"title":""}'
{ "id": "…", "title": "", "updated": "…" }        # 200. A list with no name.

$ gws tasks tasklists insert --json '{"title":"   "}'
{ "id": "…", "title": "   ", "updated": "…" }     # also 200.
```

Google accepts a blank title and creates an unnamed list. The caller reads
success; the user gets something they cannot find in the Tasks UI. So the
handler trims and rejects blank locally, and says why in the error rather than
letting a 200 stand in for a result.

### Control — end to end, real handler, real API

`tasks_create_tasklist` driven through the compiled handler and a real
`GwsClient`, against the live Tasks API as `<shell-account>`, with the vendored
0.13.2 binary.

Failing results, written down first: create reports success but the read-back
does not find the list; the delete leaves it behind; or the blank title goes
through, which would mean the check lives in the test and not in the shipped
path.

```
acting identity: <shell-account>
created: {"id":"RDZIMkl3YUIwdXROUXRabw","title":"scrum-167-live-1787944258665", …}
PASS  create returned an id and the exact title
PASS  read-back finds exactly 1 list with that id (found 1)
PASS  read-back title matches
PASS  after delete, 0 lists with that id (found 0)
PASS  blank title threw (tasks_create_tasklist: title must not be blank. …)
PASS  blank title created nothing (1 -> 1)
PASS  missing title rejected by validateArgs (missing required parameter "title")
```

The delete in step 3 goes through `client.api("tasks","tasklists","delete")`
directly, not through a tool, because no such tool is being shipped.

---

## Task 3 — the identity guard

### What the CLI actually does, verified rather than assumed

- Neither binary has an identity flag. `--help` on 0.13.2 and on 0.16.0 lists
  `--params --json --upload --output --format --api-version --page-*` and
  nothing else. Identity comes from `GOOGLE_WORKSPACE_CLI_TOKEN`, then
  `GOOGLE_WORKSPACE_CLI_CREDENTIALS_FILE`, then the keyring.
- `--account` was removed in 0.7.0 together with multi-account, domain-wide
  delegation and impersonation, per `bin/CHANGELOG.md`. No upgrade restores it.
- **`gws auth status` does not report the acting account.** It prints the
  client config path, the credential paths, the keyring backend, the project id
  and 22 scope names. No email address anywhere in the output. So the CLI's own
  "who am I" command cannot answer the question, which is why the guard has to
  resolve identity through an API call rather than reading local state.

The divergence is live on this machine right now, at the same moment, with no
configuration difference at either call site:

```
gws drive about get   (shell binary)   -> <shell-account>
gws drive about get   (through the MCP) -> <mcp-account>
```

### The guard — `scripts/gws-guard.sh`

- **read** — passes straight through. No identity call, no requirement.
- **write** — requires a stated identity (`--as you@example.com`, or
  `GWS_EXPECT_ACCOUNT`), resolves the identity the binary will actually act as
  through the same binary and the same environment, refuses on mismatch, and
  echoes the acting identity before proceeding.
- Unknown methods count as writes. Only `list get search query getProfile
  export` are treated as reads; `auth` and `schema` pass through, `auth` because
  demanding a stated identity from the command that establishes one is circular.
- Refusal exits **9**, outside the CLI's own 0–5, so a caller can tell "the
  guard stopped this" from "Google rejected this".
- `GWS_BIN` selects the binary and the guard prints which one it used, because
  the binary you get in a shell here is not the one this repository ships.
- The identity call asks for `user/emailAddress` and nothing else. A wider
  response also carries the account's display name — caller-controlled text
  sitting immediately beside the value being extracted — and narrowing the
  field leaves nothing else in the JSON to pick up by mistake. The live
  controls below were re-run after this change, not only before it.

### Control — both directions, live, against both binaries

The control is the deliverable, so it ran against the real binaries and a real
account, and the blocking cases are checked by comparing the task-list set
before and after, not by trusting the message.

**Vendored 0.13.2** (`bin/gws-aarch64-apple-darwin/gws`, the binary this
repository ships):

```
A1  write, no stated identity                        -> exit 9
    gws-guard: REFUSED — this is a write and no identity was stated.

A2  write, stated <mcp-account>, acting <shell-account>  -> exit 9
    gws-guard: REFUSED — identity mismatch — nothing was written.
          stated:  <mcp-account>
          acting:  <shell-account>
          binary:  ./bin/gws-aarch64-apple-darwin/gws

    task list set unchanged by both blocked writes    (PASS)

A3  write, stated <shell-account>, acting <shell-account>  -> exit 0
    gws-guard: binary ./bin/gws-aarch64-apple-darwin/gws (gws 0.13.2)
    gws-guard: acting as <shell-account> — proceeding with: tasks tasklists insert …
    { "id": "OERmQm0wa3gzMGxuMWhsNA", "title": "scrum-167-control-A3", … }
    list verified present, then deleted directly.
```

A2 is the original incident reproduced deliberately and stopped: the stated
identity is the one the MCP acts as, the acting identity is the one the shell
binary acts as, and before this guard the write would have succeeded and
exited 0.

**Homebrew 0.16.0** (`/opt/homebrew/bin/gws`, what `gws` means in a shell here):

```
A1 no-identity     exit=9
A2 mismatch        exit=9   stated <mcp-account> / acting <shell-account>
A3 correct         exit=0   list created, verified, deleted
read passthrough   exit=0
```

Same behaviour on both. **Upstream stable is 0.22.5 and was not tested at all.**

### Control — the hermetic tests, and a control on those

`src/gws-guard.test.ts` runs the guard against a stand-in binary that records
its own argv, so each case asserts what the binary was and was not asked to do
rather than what the wrapper printed. That distinction is the difference
between "refused" and "ran the write and said something disapproving".

13 cases: refuses with no identity and never invokes the binary at all;
refuses on mismatch after resolving but before writing; allows on a match and
forwards the command with `--as` stripped; accepts `GWS_EXPECT_ACCOUNT`;
compares case-insensitively; passes reads through with exactly one invocation;
passes `auth` through; treats `events move`, `messages trash`, `permissions
create`, `batchUpdate` and `+helper` as writes; and one case asserting a read
still passes and a write still blocks, which fails in both directions.

Green tests prove nothing on their own, so each guard was mutated to fail open
and the predicted reds were written down before running:

| Mutation | Predicted | Observed |
|---|---|---|
| Guard stops requiring a stated identity | the no-identity case plus the 5 fail-closed cases | **7 red** — those 6 plus the both-directions case, which also asserts a write blocks |
| Identity comparison always matches | exactly 1 — the mismatch case | 1 red, that one |
| Blank-title check removed from the handler | exactly 3 — the three blank-title cases | 3 red, those three |

The first prediction was one short. The direction was right and the miss is
recorded rather than rounded off: I forgot that the both-directions case
asserts a block as well as a pass.

Full suite after restoring: **13 files, 237 tests, all passing** (was 216).

---

## A check that could not fail, and reported a pass

The same lesson landed on my own tooling an hour later, and it is recorded here
rather than in a footnote because this is the third instance of the class seen
across three sessions in one day.

The pre-push secret scan ran as:

```sh
FILES="a.md b.sh c.ts …"
grep -nEi "…" $FILES || echo "  none"
```

Under `zsh` an unquoted variable is **not** word-split. `$FILES` expanded to a
single filename containing spaces, no such file existed, and every pattern
reported `none`. The scan announced a clean result for real addresses, internal
identifiers, HQ paths and credentials, having examined nothing. It failed open
and looked identical to a pass.

The tell was available and I nearly walked past it: a one-line `warning: … No
such file or directory` above output that otherwise read as success.

The rule, stated so it survives the specific bug: **a scanner needs a positive
control in the same run — a pattern known to be present, whose absence proves
the harness itself is broken.** A grep that finds nothing and a grep that
searched nothing produce the same text. The rerun used a `zsh` array, asserted
each file exists, and grepped for a term guaranteed to appear before trusting
any negative:

```sh
FILES=(a.md b.sh c.ts …)
for f in $FILES; do [ -f "$f" ] || echo "MISSING: $f"; done
grep -nEi "tasklist" "${FILES[@]}" | head -2      # positive control
```

That run found the real answers: the only addresses in the diff are
`example.com`, the domain and secret-shaped hits are all pre-existing lines in
files this change only edits a count in, and the three lines this diff adds to
`README.md` and `CLAUDE.md` are tool counts.

This is the same failure the mutation pass above exists to prevent, one level
out: the mutations checked whether the *tests* could fail, and nothing was
checking whether the *scanner* could. Shell word-splitting is the accident;
"a verification that cannot produce a red is not a verification" is the finding.

---

## Task 3(b) — our own call site

Three paths, and they are not alike.

**HTTP mode (`index.ts`, the gateway and Claude Code) — safe, no guard added.**
The MCP bearer token is applied per call at `gws-client.ts:317-318` as
`{ ...this.mergedEnv, GOOGLE_WORKSPACE_CLI_TOKEN: token }`. The explicit token
is the last key, so it wins over anything inherited, unconditionally. Identity
is bound to the authenticated MCP session and is stated by the transport rather
than picked up from the environment. This is the mode the incident involved and
it was never the wrong half of it.

**stdio/extension mode (Claude Desktop) — a residual, not fixed here.**
With no bearer token, `exec` uses `mergedEnv`, which is
`{ ...process.env, ...env }` at `gws-client.ts:243` and never clears the
identity variables. An ambient `GOOGLE_WORKSPACE_CLI_TOKEN` in the server's
environment therefore silently outranks the extension's own login. Verified
against the real binary:

```
$ gws drive about get                                     -> <shell-account>
$ GOOGLE_WORKSPACE_CLI_TOKEN=not-a-real-token gws drive about get
  401 … "Request had invalid authentication credentials"   (exit 1)
```

The ambient variable is used, not ignored. A *valid* token for another account
in that slot would not error — it would write there and exit 0, which is the
same mechanism as the original finding, inside our own process.

I am not fixing it in this change. It has no observed instance, the fix
(stripping identity variables from the inherited environment) changes how a
self-hosted deployment configures itself, and it deserves its own deploy and
its own rollback identifier. **It is a scope decision for HQ, and it is the one
thing in this report I would put first if only one item got read.**

**`gws_run`** remains the generic fallback and reaches the same client, so it
inherits whichever of the above applies. It is not separately exposed.

---

## Other gaps of the same shape — listed, not built

A container that cannot be created, or a resource with no create verb, is a
standing reason for someone to drop to the bare CLI. From the 65 tools that
actually ship:

1. **Calendar — no way to create a calendar.** `calendar_*` can create, update
   and delete *events*, but only inside calendars that already exist. This is
   the Tasks gap exactly, one service over.
2. **Drive — no way to create a file.** `drive_create_folder` exists;
   `drive_*` is otherwise search and read. No upload, no file create, and no
   way to create a shared drive.
3. **Contacts — no way to create a contact group.** `contacts_*` creates,
   updates and deletes contacts; the group/label container has no tool.

Not a gap: **Gmail filters.** `gmail_list_filters` reads them and there is no
create or delete, but that is a deliberate withholding pending the
`settings.basic` scope, documented in `gws-client.ts`.

---

## Boundary

**Proven.** The guard blocks a write with no stated identity and a write with a
wrong stated identity, and allows a correct one, against both the vendored
0.13.2 and the Homebrew 0.16.0 binary, with the real API and two real accounts,
verified by before/after state and not only by exit codes. The blocking
behaviour is pinned by tests that go red when the guard is mutated to fail open.
`tasks_create_tasklist` creates, reads back, deletes and refuses a blank title
against the live API.

**Not proven, awaiting a real user.** Nobody has typed `gws-guard.sh` in anger.
The guard is a wrapper, so it protects the calls that go through it and does
nothing for a call that does not — it is a seatbelt, not an interlock. It is
adopted by being used, and this change does not make anything call it. The
deeper fix remains closing the tool gap so nobody reaches for the CLI at all.

**Unsure.** The read/write classification is a judgement about method names.
`list get search query getProfile export` are treated as reads; everything else,
including methods that do not exist yet, is a write. I believe that set is
correct for the services this repository touches, and I have not enumerated
every method of every service in the discovery documents to be certain. The
error direction is a read misclassified as a write, which costs one resolution
call and a clear message.

**Not tested.** Upstream 0.22.5. The vendored version was deliberately left at
0.13.2; a version bump is its own deploy.

**Branch overlap.** None live. All four named branches
(`chore/simplify-pass`, `feature/scrum-113-sheets-parity`,
`fix/scrum-121-boundary-and-render`, `fix/scrum-158-html-email`) are already
contained in `origin/main`, confirmed with `git merge-base --is-ancestor`.

**Prompt-injection surface (SCRUM-159).** `tasks_create_tasklist` passes the
caller's title through as data: it is trimmed, checked for emptiness, and
placed in a JSON body. Nothing in this change interprets it, pattern-matches
it, or lets it influence control flow, which is the property that has to hold
when the title's eventual source is the text of an email.
