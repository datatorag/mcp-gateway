# SCRUM-170: vendored gws CLI 0.13.2 → 0.17.0 verification report

Branch: `feature/chore/gws-cli-0.17.0`, off `main` at b222097. One change:
the version pin in `scripts/download-binaries.sh`. No `src/` file is touched.

Versions this report depends on: upstream release `v0.17.0` (published
2026-03-17), replacing `v0.13.2` (2026-03-12). Verification ran 2026-08-28,
final pass at 21:47 PDT, on macOS arm64 and, via Docker (`linux/amd64`
emulation), Debian bookworm x86_64. It builds on the 0.13.2 → 0.22.5 review of the same ticket, which
was blocked and whose changelog adjudication is carried here, not redone.

## Lead: the login URL is on stderr, and the bump is clean

**The OAuth login URL prints to STDERR on 0.17.0.** This was the one thing
that had to be verified before shipping, because 0.22.5 prints it to stdout
and `spawnAuthForUrl` in `src/gws-client.ts` listens on stderr only. It is
not a changelog inference; it was observed, and it holds for every release
between the two as well (see the range search). No change to
`src/gws-client.ts` is needed, so none was made.

The failing result was written down before the probe ran: FAIL if the
`accounts.google.com/o/oauth2/auth` URL appears on the stdout capture and
not on stderr within 10 s; INCONCLUSIVE if it appears on neither (a probe
error, e.g. exit 2 before the URL); PASS only on stderr. Result: stderr,
230 ms, nothing at all on stdout.

Three things kept the probe honest:

- **Controls.** The same harness against 0.13.2 (the current pin) says
  stderr, and against a fake program that prints a URL on stdout it says
  stdout. A harness that can only ever say "stderr" would have passed the
  same way, so the second control is the one that matters.
- **The compiled client.** `server/gws-client.js` `spawnAuthForUrl("drive")`
  driven against `bin/` at 0.17.0 resolves the URL in ~200 ms. On 0.22.5 the
  same call timed out to `undefined`.
- **Isolation.** Every invocation of every binary in this report ran with
  `GOOGLE_WORKSPACE_CLI_CONFIG_DIR` set inline to a fresh throwaway
  directory, plus dummy client id/secret in env. The real config directory
  was listed (never written) before and after, and its listing is
  identical. Nothing in this session touched it, and the 0.22.3+ binaries
  that delete credentials on a keychain failure were not run at all.

### Range search: where does the URL move to stdout?

The earlier report suspected 0.19.0 or 0.22.2 but compared only the
endpoints. Every release between 0.17.0 and the last one that predates the
keychain change was probed with the same harness:

| Release | URL stream |
|---|---|
| 0.13.2 (current pin) | stderr |
| **0.17.0 (this pin)** | **stderr** |
| 0.18.0, 0.18.1 | stderr |
| 0.19.0 | stderr |
| 0.20.0 | stderr |
| 0.21.1 | stderr |
| 0.22.0, 0.22.1 | stderr |
| 0.22.3, 0.22.4, 0.22.5 | **not probed**, deliberately (credential-deleting keychain behaviour enters at 0.22.3) |

There is no `v0.22.2` release. So the move to stdout enters at 0.22.3,
0.22.4 or 0.22.5, not at 0.19.0, and every version up to 0.22.1 is
compatible with `spawnAuthForUrl` as written. That sets the ceiling for the
next bump without a client change.

### Two corrections to the version mapping, for the record

Neither affects 0.17.0; both matter for the next bump.

1. **The release-asset rename enters at 0.21.1, not 0.22.4.** 0.20.0 still
   serves `gws-<target>.tar.gz`; 0.21.1, 0.22.0 and 0.22.1 serve only
   `google-workspace-cli-<target>.tar.gz`. A `VERSION=` bump past 0.20.0
   404s in the download script.
2. **The Linux glibc floor is unchanged at 0.17.0.** The binary's highest
   required symbol version is `GLIBC_2.34`, the same as 0.13.2's. Under
   `debian:bookworm-slim` (glibc 2.36, the gateway image) it starts,
   reports `gws 0.17.0`, and exits 3 on an unknown service; a non-ELF file
   run the same way fails, so the container was actually executing things.

## The download script

`VERSION="0.13.2"` → `VERSION="0.17.0"`. That is the whole diff. The four
asset names, the tarball layout (`gws-<target>/gws`), and the Windows zip
layout (`gws.exe` at the root) are all as the script and `gws-client.ts`
expect; the name-mapping did not need to change, which is what the version
table predicted.

## Checksums

Yes, the release publishes them: a `.sha256` beside every asset and a
combined `sha256.sum`. All four archives this repo uses were re-downloaded
and verified against both, and the hashes also match GitHub's own asset
digests:

```
e05e9c4f4ee08590757a606394459cce0c6a04dd6f33e5215877beaa460abe20  gws-aarch64-apple-darwin.tar.gz
8493c88926518934f860d864ee35006a3357a59d6d14fd025708b37da35b1515  gws-x86_64-apple-darwin.tar.gz
83aa90d2dd2341756cdf9ab0738844fc467881cd965e8257cb5b4c4ebdbacae7  gws-x86_64-unknown-linux-gnu.tar.gz
eab43372c3890a5e41c926239e3e0789523ccea692ef23265138b1eb11c2478b  gws-x86_64-pc-windows-msvc.zip
```

(The `.sha256` files end in CRLF and have a trailing blank line, so
`shasum -c` warns about a malformed line while reporting each hash OK.) The
script does **not** verify checksums itself; that would be a second change.
Recommended follow-up, pinning the four hashes above.

## Test suite

`npx tsc`, `npx tsc -p tsconfig.test.json` and
`npx vitest run --exclude '**/.worktrees/**'` all exit 0, with the exit codes
read directly rather than through a pipe (a first pass piped them to `tail`,
which discards the exit code, and was redone): **14 files, 246 tests, 246
passed, 0 skipped, 0 todo**, on a clean `pnpm install --frozen-lockfile`.
The 14 files are the 14 `*.test.ts` under `src/`, none from a sibling. The
exclusion matters because sibling worktrees are nested inside the repo and a
plain run picks up their tests. As before: **the suite never spawns the
binary** (handlers are driven through fake clients), so green proves the
handlers compile and behave, and says nothing about 0.17.0. Everything
below is what does.

## Changelog, 0.13.3 → 0.17.0, carried from the 0.22.5 review

Adjudicated in full there; only the rows inside this bump's range are
restated, with what this session added.

| Version | Entry | Affects us? | Status now |
|---|---|---|---|
| 0.13.3 | JSON arrays expand into repeated query params | No; `assertScalarParams` is now stricter than the binary needs | Unchanged, follow-up |
| 0.14.0 | Upload Content-Type inferred from extension when absent | Low; `drive +upload` for attachments | Dry-run verified with the exact flags `gmail.ts` passes (`--name`, `--parent`): multipart POST to `/upload/drive/v3/files`, body `{name, parents}` |
| 0.15.0 | `GOOGLE_WORKSPACE_CLI_LOG*` env vars | Cosmetic, off by default | Unchanged |
| 0.16.0 | RFC 2047 encoding of non-ASCII display names / subjects | Yes, the fix we want | **Observed**: a `+send --dry-run` with a non-ASCII subject now carries `Subject: =?UTF-8?B?…?=` in the decoded MIME |
| 0.17.0 | Stderr hygiene: `error[variant]:` labels on stderr | Yes, format only | Verified below; no failure becomes a success |
| 0.17.0 | Atomic write, Retry-After cap, `--upload`/`--output` path validation | No | Not exercised |
| 0.17.0 | Zero-width / bidi / U+2028 input validation | Must not fire on document text | Verified: a `docs batchUpdate --dry-run` body containing U+200B, U+202E and U+2028 round-trips unchanged |

Notably **not** in this range: the mail-builder rewrite (0.18.0). On 0.17.0
`gmail +send` still POSTs a base64 `raw` JSON body to
`/gmail/v1/users/me/messages/send`, the same wire format as 0.13.2, and the
`--dry-run` still exposes the MIME so it can be read.

## `src/gws-client.ts` blast radius, through the compiled module

Each check had its failing condition written first.

| # | Check | Fails if | Result |
|---|---|---|---|
| E1 | `exec(["--version"])` | not `gws 0.17.0` | pass |
| E2 | unknown service | not thrown as validation (exit 3) | pass, `Validation error: error[validation]: Unknown service …` |
| E3 | malformed `--params` JSON | not exit 3 | pass |
| E4 | real call with no credentials | not the "authentication required" mapping (exit 2) | pass |
| E5 | `drive files list --dry-run` with `--params` | no success envelope | pass, GET with both query params |
| E6 | `tasks tasklists insert --json --dry-run` | body not carried | pass |
| E7 | Unicode control characters in a `--json` body | validation rejects document text | pass, body round-trips |
| E8 | `auth status` with no credentials | thrown | pass, `auth_method: "none"` envelope, exit 0 |
| H1 | `gmail +send` with `--to --subject --body --cc --bcc` | flag rejected | pass; RFC 2047 subject observed |
| H2 | `gmail +reply --message-id --body --html` | flag rejected | pass |
| H3 | `gmail +forward --message-id --to --body` | flag rejected | pass |
| H4 | `drive +upload <file> --name --parent` | flag rejected | pass (a first attempt with an invented `--mime-type` flag was rejected; that was the probe's error, `gmail.ts` never passes it) |
| R1 | raw exit codes for E2/E3/E4/E5 and a helper with an unknown flag | any code re-meaning'd | pass: 3, 3, 2, 0, 3; `--help` table for codes 0–5 unchanged |
| R2 | ANSI escapes on piped stderr across those runs | any `\x1b` | pass: 0 in 678 bytes; positive control on a `printf` escape found 1 |
| R3 | stderr on a successful dry-run | anything | pass: 0 bytes |

One observation, not a change: `auth login` on both 0.13.2 and 0.17.0
writes a `client_secret.json` into the config dir from the env-provided
client id/secret. Same behaviour on both, so not a regression, but it is
why a probe must never run against a config dir you care about.

Windows: archive layout verified (`gws.exe` at zip root, lands at
`bin/gws.exe`); the binary was not executed.

## Services exercised end to end against 0.17.0

**None.** The local CLI has no stored credentials (they were deleted in
this ticket's earlier incident and have not been restored), and restoring
them means completing a browser OAuth flow this session cannot drive. The
hosted MCP gateway was not used as a substitute because it runs whatever
binary is deployed there, which is not 0.17.0, so a green result from it
would say nothing about this bump.

What is covered is everything up to the network for Gmail (send, reply,
forward), Drive (list, upload), Tasks (insert) and Docs (batchUpdate):
argument assembly, flag acceptance, exit-code mapping, error parsing,
request construction. What is not covered, for any service, is the
response shape from Google as rendered by 0.17.0. The 0.13.3–0.17.0
changelog contains no entry that alters response rendering, and the wire
format of every call we make is unchanged, so the risk is low, but it is
unproven.

To close this gap: `gws auth login` with the 0.17.0 binary from `bin/` (or
the extension's own first-run flow) against a config dir of the user's
choosing, then one read per service through the compiled server. That is a
ten-minute pass once someone can click through the consent screen.

## Boundary

**Proven**
- 0.17.0 binaries download, match published checksums, extract into the expected layout, and run on macOS arm64 and Linux at glibc 2.34+ (bookworm's 2.36 verified).
- The OAuth URL is on stderr, from 0.13.2 through 0.22.1 inclusive; `spawnAuthForUrl` works unchanged.
- Exit codes 0–5 keep their meanings; the 2/3 branches in `exec()` map as before; stdout JSON is still the error body; stderr gained a label and nothing was removed.
- Unicode validation does not reject request bodies.
- Every helper flag set `gmail.ts` builds is accepted; the Gmail wire format is unchanged from 0.13.2.
- The unit suite is green, and irrelevant to the binary.

**Unsure**
- Every live response shape, on every service. Untested.
- Windows binary runtime.
- Which of 0.22.3/0.22.4/0.22.5 moves the URL to stdout. Not searched, on purpose.

**Deliberately not done**
- No change to `src/gws-client.ts`. None was needed, and it is contended by other in-flight work.
- No checksum pinning in the download script (follow-up).
- No live login to restore local credentials: that needs a person at a browser and a decision about which config dir to log into.
- No probe of any 0.22.3+ binary, against any config dir.
- Not merged, not deployed.

## Appendix: the stream probe

Kept here because a scratch harness does not survive, and the next bump
needs to run exactly this against the next binary. Invoke with a throwaway
config dir and dummy client credentials in the environment, never with the
real ones:

```
GOOGLE_WORKSPACE_CLI_CONFIG_DIR=<fresh empty dir> \
GOOGLE_WORKSPACE_CLI_CLIENT_ID=probe-dummy.apps.googleusercontent.com \
GOOGLE_WORKSPACE_CLI_CLIENT_SECRET=probe-dummy-secret \
node probe.mjs <label> <path-to-gws> auth login --scopes https://www.googleapis.com/auth/drive
```

Expected on a compatible binary: `"stream": "STDERR"`. Run it once more with
`node -e 'console.log("https://accounts.google.com/o/oauth2/auth?fake=1"); setTimeout(()=>{}, 30000)'`
in place of the binary and confirm it says `STDOUT`; a harness that has never
said STDOUT has not been shown to be able to.

```js
// Probe: which stream does the OAuth URL land on? Args: <label> <cmd> [args...]
import { spawn } from "node:child_process";
const [label, cmd, ...args] = process.argv.slice(2);
const RE = /https:\/\/accounts\.google\.com\/o\/oauth2\/auth\S+/;
const t0 = Date.now();
const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
let out = "", err = "", done = false;
function finish(stream) {
  if (done) return; done = true;
  const r = { label, stream, elapsed_ms: Date.now() - t0,
    stdout_matches: RE.test(out), stderr_matches: RE.test(err),
    stdout_head: out.slice(0, 300), stderr_head: err.slice(0, 300) };
  console.log(JSON.stringify(r, null, 2));
  try { child.kill("SIGKILL"); } catch {}
  setTimeout(() => process.exit(0), 200);
}
child.stdout.on("data", (c) => { out += c; if (RE.test(out)) finish("STDOUT"); });
child.stderr.on("data", (c) => { err += c; if (RE.test(err)) finish("STDERR"); });
child.on("close", (code) => { if (!done) { err += `\n[closed code=${code}]`; finish("NONE (closed)"); } });
setTimeout(() => finish("NONE (timeout 10s)"), 10_000);
```
