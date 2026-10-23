# Inbound File References Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user's own file into Drive, Jira and Gmail through the gateway, in two ways:
- a `content` reference that carries base64 in the call;
- a single-use upload link with a drop page and a curl line.

Both give the same receipts as the outbound tools.

**Architecture:**
- **Local reference types.** Two new types sit beside the four plugin-sourced ones. They are resolved inside the gateway by `file-inbound.ts`, and both end on the unchanged destination leg of `crossFile`.
- **The upload store.** `file-upload.ts` mirrors the download-link store. Its PUT and its page are served by the router that already owns `/files`.
- **The consume protocol** moves the tool arguments from a header into a length-prefixed body, so an email body fits.

**Tech Stack:** TypeScript, Express (gateway), Node HTTP (plugins), vitest. No new dependency.

**Spec:** `docs/architecture/2026-10-23-scrum-437-inbound-file-references-design.md`

## Global Constraints

- **Caps.** `content` at most 5 MB decoded (`MAX_CONTENT_BYTES = 5 * 1024 * 1024`). Uploads at most 25 MB (`MAX_FILE_BYTES`).
- **Life.** An upload link lives ten minutes from minting. A held file lives ten minutes from receipt.
- **Upload limits.**
  - one file per link;
  - `MAX_OPEN_UPLOADS_PER_USER = 3` (open, receiving or received);
  - 40 records per user and 10,000 per host;
  - held bytes per host 256 MB (`MAX_HELD_UPLOAD_BYTES`).
- **Slots.** Upload PUTs use their own pool, `MAX_UPLOADS_HOST = 2`, never the `transfer` pool. One file per user across all pools, as today.
- **Corridor.** Nothing is written to disk. No log line carries a token, a file name, a hash or file content: one line per request, with the method, the outcome and a byte count.
- **Refusals** are one actionable sentence, in the register of the existing file-reference refusals.
- **Copy** has no em dashes, no counts of services or tools, and no scope URLs.
- **Public repo:** the rule, never the evidence. No internal ids or customer names in code, docs or commits.
- **Built-in tool flags.** `file_upload_link` is declared `approval: "write"`, `metered: true` and `attended: true`.
- **Tests run as:**
  - gateway: `cd apps/gateway && env -u NODE_TLS_REJECT_UNAUTHORIZED node --env-file=<repo-root>/.env node_modules/vitest/vitest.mjs run <files>`;
  - plugins: `pnpm --filter @datatorag-mcp/<slug> run test`;
  - gate: `env -u NODE_TLS_REJECT_UNAUTHORIZED sh scripts/gate.sh` from the repo root.
- **Every change to a plugin tool's description or schema** ships with a registry pair from `pnpm registry:diff <slug> --from <running sha> --to <new sha>`, committed under `registry/`.

## Review Focus

1. **A `content` reference with whitespace or line breaks in its base64** (models wrap long base64). It must be refused with a sentence saying base64 must be one unbroken string, never decoded into a corrupted file. Test: Task 2.
2. **The same upload consumed by two calls racing.** Exactly one may move bytes; the other is told "already in use" and nothing is sent. Test: Task 9.
3. **A held upload expiring while its consuming call is mid-send.** The send finishes, the upload ends `consumed` and never `expired`, and the bytes are dropped once. Test: Task 9.
4. **A curl PUT with no name** (no slash, no header) and a file whose name is all disallowed characters. It is stored as `upload` plus the extension, never as an empty name. Test: Task 10.
5. **An email whose args pass 8 KB with a referenced attachment.** It goes through, and an email whose args pass 1 MB is refused before any byte moves. Test: Task 5.

---

## Phase 1: `content` on Jira and Drive

### Task 1: Authenticate `/mcp` before parsing its body, then allow 8 MB

**Files:**
- Create: `apps/gateway/src/gateway/mcp-body-gate.ts`
- Create: `apps/gateway/src/gateway/mcp-body-gate.test.ts`
- Modify: `apps/gateway/server.ts:169` (the `app.use("/mcp", express.json())` line) and `app.all("/mcp")` (reads the auth result instead of validating again)

**Interfaces:**
- Produces: `createMcpBodyGate(validate: (token: string) => Promise<BearerResult>): RequestHandler[]`. It is a bearer check that stores the result on `res.locals.mcpAuth`, followed by `express.json({ limit: "8mb" })`.
  - A request with no bearer, or one that fails validation, skips the parser: `next()` is called with `req.body` unset.
  - `app.all("/mcp")` keeps its existing 401 branches and tracking, but reads `res.locals.mcpAuth`.
- `BearerResult` is the type `validateBearer` already returns.

- [ ] **Step 1: Write the failing tests.**
  - `parses a 7 MB JSON body for a valid bearer` (`req.body` is the parsed object);
  - `does not parse the body without a bearer` (`req.body` undefined, the stream not consumed);
  - `does not parse the body for a bearer that fails validation`;
  - `refuses a body over 8 MB with 413 for a valid bearer`.

  Drive the handlers with a real `express()` app on an ephemeral port and `fetch`.
- [ ] **Step 2: Run them.** Expected: FAIL (module missing).
- [ ] **Step 3: Implement `createMcpBodyGate`** and wire it in `server.ts`. `extractClientInfo(req.body)` must tolerate an unset body (it already returns `{}` for non-objects; confirm).
- [ ] **Step 4: Run the new tests, then the existing `/mcp` tests** (`mcp-session`, `mcp-analytics`, the 401 tests). Expected: PASS.
- [ ] **Step 5: Commit.** `feat(gateway): authenticate /mcp before parsing its body; allow 8 MB`

### Task 2: Local reference types and the `content` resolver

**Files:**
- Create: `apps/gateway/src/gateway/file-inbound.ts`
- Create: `apps/gateway/src/gateway/file-inbound.test.ts`
- Modify: `apps/gateway/src/gateway/file-crossing.ts`: add `LOCAL_REFERENCE_TYPES` and `isLocalReference`, and let `readReference` and `referenceExample` take the union.
- Modify: `apps/gateway/src/gateway/file-crossing.test.ts`

**Interfaces:**
- Produces, in `file-crossing.ts`:
  - `LOCAL_REFERENCE_TYPES: Record<"content" | "upload", { requiredStrings: readonly string[]; describes: string }>`, where `content` requires `["name", "base64"]` and `upload` requires `["upload_id"]`;
  - `isLocalReference(ref: FileReference): boolean`;
  - `readReference(args, fileArg, toolName, opts?: { local?: boolean })`. `local` defaults to `true`, and when `false` the example text lists only the four plugin types and a local type is refused as unknown;
  - `referenceExample(type)` for all six types.
- Produces, in `file-inbound.ts`:
  - `MAX_CONTENT_BYTES`;
  - `cleanInboundName(name: string): string`, which is `safeDownloadName` plus a 200-UTF-16-unit fit that keeps the extension;
  - `typeForName(name: string, declared?: unknown): string`;
  - `resolveContent(ref: FileReference): { ok: true; file: SourceFile } | { ok: false; text: string }`.

- [ ] **Step 1: Write the failing tests.**
  - `readReference` accepts `{type:"content",name:"a.png",base64:"iVBO"}` and refuses `account` on a local type with the sentence "A content reference names no account: the file comes with the call."
  - `resolveContent` cases:
    - decodes `"aGk="` to the bytes `hi`;
    - refuses `"aGk=\n"` and `"aG k="` with "The base64 must be one unbroken string of the standard alphabet. Nothing was uploaded.";
    - refuses the base64url character `-`;
    - refuses an empty file;
    - refuses `Math.ceil(MAX_CONTENT_BYTES / 3) * 4 + 4` characters BEFORE decoding (spy on `Buffer.from` not called) with a sentence naming `file_upload_link` and "5 MB".
  - `cleanInboundName` cases: `"../.npmrc"` → `"npmrc"`, `"con.txt"` → `"download.txt"`, and a 300-character name with `.pdf` → length ≤ 200, ending in `.pdf`.
  - `typeForName` cases: `("a.png", "image/png")` → `"image/png"`, `("a.png", "not a type")` → `"image/png"`, `("a.zzz")` → `"application/octet-stream"`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
  - The base64 check is `/^[A-Za-z0-9+/]*={0,2}$/` with length % 4 in {0, 2, 3} once padding is stripped.
  - The extension table covers png, jpg, jpeg, gif, webp, svg (as `image/svg+xml`), pdf, txt, csv, md, json, zip, docx, xlsx and pptx.
  - Export the table as `EXTENSION_TYPES`, because Task 10 and Task 13 reuse it.
- [ ] **Step 4: Run them, and the existing `file-crossing.test.ts`.** Expected: PASS, with the existing refusal-text snapshots updated only where the example list now names six types.
- [ ] **Step 5: Commit.** `feat(gateway): content file references, resolved in the gateway`

### Task 3: `crossFile` takes local references; the download link and the Agent refuse what they must

**Files:**
- Modify: `apps/gateway/src/gateway/file-crossing.ts`. `crossFile` branches on `isLocalReference`, and the destination receives the closed file argument.
- Modify: `apps/gateway/src/gateway/file-download.ts`. `createDownloadLink` calls `readReference(..., { local: false })`, plus a dedicated sentence for the local types.
- Modify: `apps/gateway/src/gateway/mcp-server.ts`, at the crossing call (line ~1302). It passes `surface`, and the Agent refusal lives in `crossFile`.
- Test: `apps/gateway/src/gateway/file-crossing.test.ts`, `file-download.test.ts`, `mcp-server.file-crossing.test.ts`

**Interfaces:**
- Consumes: `resolveContent`, `isLocalReference` (Task 2).
- Produces:
  - `closedFileArg(ref: FileReference): Record<string, unknown>`, which is `{type}` for a local reference and the existing closed form otherwise;
  - `crossFile` sends `args` with the file argument replaced by `closedFileArg(ref)`.

- [ ] **Step 1: Write the failing tests.**
  - **Jira.** `crossFile` with a `content` reference to `jira_add_attachment`:
    - calls no source route;
    - POSTs the decoded bytes to `/internal/consume`;
    - sends `X-Tool-Args` that decode to `{issue_key, file: {type: "content"}}` with no `base64` key;
    - sends `X-File-Name` of the cleaned name.
  - **Drive.** The same for `drive_upload_file`.
  - **Agent surface.** `surface: "agent"` with a `content` reference is refused: "A content reference cannot be used in the dashboard Agent. Ask for an upload link instead with file_upload_link. Nothing was uploaded." No route is called.
  - **Download link.** `createDownloadLink` with a `content` or `upload` reference answers "This file is already on your side; a download link is for files in a connected service. No link was made." and reads nothing.
  - **Slot.** A `content` crossing holds a `transfer` slot: `transfersInFlight().host === 1` during the destination fetch.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The local branch skips `resolveSource` and `fetchSourceFile`, and calls `withTransferSlot` around `sendToDestination` with the resolved file. The encoded args are computed from the closed args.
- [ ] **Step 4: Run them, then all `file-*` and `mcp-server*` tests.** Expected: PASS. Every existing crossing test is unchanged.
- [ ] **Step 5: Commit.** `feat(gateway): content references cross to Jira and Drive`

### Task 4: Describe the new type to callers; docs; registry pair; runner cases FD5 to FD8

**Files:**
- Modify: `plugins/gws-mcp/src/tools/drive-upload.ts`: the `file` description and the tool description gain the `content` shape and its 5 MB cap.
- Modify: `plugins/atlassian-mcp/src/tools/jira.ts`: the `jira_add_attachment` `file` description, the same.
- Modify: the gws-mcp tests that pin descriptions (`described-not-instructed.test.ts` stays green).
- Create: `registry/2026-10-2x-scrum-437-content-reference.sql` and `.rollback.sql` (generated, not hand-written).
- Modify: `apps/gateway/content/docs/file-references.md`. The type table gains `content`, a section "Sending a file you have", and "Limits" gains 5 MB.
- Create: `apps/gateway/src/gateway/tests/cases/fd5-content-into-drive.ts`, `fd6-content-onto-jira.ts`, `fd7-content-not-a-download.ts`, `fd8-content-oversize.ts`.
- Modify: `apps/gateway/src/gateway/tests/cases/index.ts` (register them).

**Interfaces:**
- Consumes: Tasks 2 and 3 behaviour. The runner cases follow `fd3-download-drive-file.ts`: `ctx.call`, `resultJson`, byte counts and booleans only in evidence.
- **FD5** sends a fixed 1 KB generated PNG as `content` into the fixture folder. It asserts `sent.sha256` equals the SHA-256 the case computed and `checksum_match === true`, then trashes the file.
- **FD6** does the same onto the fixture Jira issue, asserting the receipt's byte count and SHA-256, then deletes the attachment.
- **FD7** asserts the refusal text on `file_download_link`.
- **FD8** sends 5 MB + 1 decoded and asserts the refusal names `file_upload_link`.

- [ ] **Step 1: Edit the descriptions.** Run both plugin test suites. Expected: PASS.
- [ ] **Step 2: Write the cases and register them.** Run `cases` unit tests (`registry.test.ts`, `case-arguments.test.ts`, `no-fixture-values.test.ts`). Expected: PASS.
- [ ] **Step 3: Docs.** Edit `file-references.md`. Run the docs/content tests (claims and em-dash checks). Expected: PASS.
- [ ] **Step 4: Gate, then commit.** `feat: content file references on Jira and Drive, docs and runner cases`
- [ ] **Step 5: After merge, the registry pair.** Generate it with `pnpm registry:diff gws-mcp` and `pnpm registry:diff atlassian-mcp` against the merged sha. Commit it on its own branch for the registry workflow.

---

## Phase 2: Gmail attachments by reference

### Task 5: The consume protocol carries arguments in the body

**Files:**
- Modify: `apps/gateway/src/gateway/file-crossing.ts`. `sendToDestination` sends `X-Tool-Args-Length` and a body of args then bytes. `MAX_ENCODED_ARGS_CHARS` becomes `MAX_ARGS_BYTES = 1024 * 1024`.
- Modify: `plugins/gws-mcp/src/internal/consume.ts` and `plugins/atlassian-mcp/src/internal/consume.ts`: read the framed body.
- Test: `file-crossing.test.ts`, both plugins' `consume.test.ts`.

**Interfaces:**
- Produces, in each plugin's `consume.ts` (a small function duplicated in both, because the plugins share no package):
  ```
  readFramedBody(body: AsyncIterable<Uint8Array>, argsLength: number, argsCap: number, fileCap: number): Promise<{ args: Record<string, unknown>; bytes: Buffer }>
  ```
  It throws `BodyTooLarge` or `BadArgs`.
- Header contract: `X-Tool-Args-Length` is a decimal string, 1 to 1,048,576. `X-Tool-Args` is no longer read.

- [ ] **Step 1: Write the failing tests.**
  - **Gateway.** The destination request carries `X-Tool-Args-Length`, and its body starts with exactly that many bytes of JSON args. Args of 20 KB (an HTML body) are accepted. Args of 1 MB + 1 are refused with "The arguments to <tool> are too large to send with a file. Shorten them and try again." and no request is made.
  - **Plugins, each.**
    - A framed body splits into the same args and bytes;
    - a missing or non-numeric length is 400 `bad_request`;
    - a length past 1 MB is 400;
    - args that are not a JSON object are 400;
    - a file past 25 MB is 413;
    - a body shorter than the declared length is 400.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The frame split is the one non-obvious algorithm. Accumulate chunks until `argsLength` bytes are in hand, slice the remainder of that chunk into the file chunks, then continue with the existing capped read.
- [ ] **Step 4: Run gateway `file-crossing*` and both plugins' tests.** Expected: PASS. The existing Jira and Drive crossing tests are updated only for the new header.
- [ ] **Step 5: Commit.** `refactor: consume routes take tool arguments in the body`

### Task 6: Gateway finds a reference entry in a Gmail call

**Files:**
- Modify: `apps/gateway/src/gateway/file-crossing.ts`. `FILE_CONSUMING_TOOLS` is replaced by `fileArgFor`.
- Modify: `apps/gateway/src/gateway/mcp-server.ts`, where `fileCrossingFor(name)` becomes `fileArgFor(name, args)`.
- Test: `file-crossing.test.ts`, `mcp-server.file-crossing.test.ts`.

**Interfaces:**
- Produces:
  - `type FileArgPath = readonly [string] | readonly ["attachments", number]`;
  - `fileArgFor(tool: string, args: Record<string, unknown>): { path: FileArgPath } | { refusal: string } | null`.
    - The Jira and Drive tools answer `["file"]`.
    - The five Gmail compose tools (`gws-mcp__gmail_send`, `__gmail_create_draft`, `__gmail_reply`, `__gmail_forward`, `__gmail_update_draft`) answer the index of the one `attachments` entry that is an object with a string `type`. With none they answer `null`. With two or more they answer `{refusal}`.
  - `crossFile` reads and closes the reference at `path`.

- [ ] **Step 1: Write the failing tests.**
  - A Gmail call with only Drive ids is not a crossing (`null`), and `mcp-server` calls the plugin as today.
  - One `{type:"content"}` entry at index 1 answers `{path:["attachments",1]}`.
  - Two reference entries answer `{refusal: "One attachment per message can be a file reference; the rest must be Drive files. Nothing was sent."}`.
  - `{file_id:"x", as:"pdf"}` is not a reference.
  - `crossFile` sends args whose `attachments[1]` is `{type:"content"}`.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(gateway): a Gmail compose call can carry one file reference`

### Task 7: gws-mcp composes with a supplied file

**Files:**
- Modify: `plugins/gws-mcp/src/internal/consume.ts`: register the five Gmail tools.
- Modify: `plugins/gws-mcp/src/tools/gmail.ts`. `handleGmail` takes an optional `supplied?: SuppliedFile`, and the five cases pass it to attachment resolution.
- Modify: `plugins/gws-mcp/src/attachments/resolve.ts`:
  - `parseAttachments` skips the entry `{type: ...}` only when a supplied file is given, and refuses it otherwise;
  - `resolveAttachments(client, entries, supplied?)` adds a `PlannedFile`;
  - `ReportEntry.source` gains `"supplied"`.
- Test: `plugins/gws-mcp/src/tools/gmail*.test.ts`, `src/attachments/*.test.ts`, `src/internal/consume.test.ts`.

**Interfaces:**
- Consumes: `SuppliedFile` from `drive-upload.ts` and the framed consume request from Task 5.
- Produces: `resolveAttachments(client: GwsClient, entries: ParsedEntry[], supplied?: SuppliedFile): Promise<Resolved>`. The supplied file is planned with `contentId: contentIdFor(name)` and `open: async function*(){ yield bytes }`, and counted in `TOTAL_CAP` before any Drive read.

- [ ] **Step 1: Write the failing tests.**
  - **Drafts.**
    - `gmail_create_draft` through consume, with a supplied 70-byte PNG and one Drive id, streams a `message/rfc822` whose parts include the PNG under its name. The report lists it as `{source:"supplied", mode:"attached"}`.
    - With `html_body` containing `<img src="cid:a.png">` it is `inline`.
    - Supplied 24 MB plus a 2 MB Drive file is refused before any Drive download with the existing 25 MB sentence.
  - **Forward.** `gmail_forward` counts the original's parts plus the supplied file.
  - **No supplied file.** A `{type:"content"}` entry reaching `handleGmail` over plain `/mcp` (no supplied file) is refused with "This attachment is a file reference and has to come through the gateway. Nothing was sent."
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the gws-mcp suite.** Expected: PASS, with every existing Gmail test unchanged.
- [ ] **Step 5: Commit.** `feat(gws-mcp): Gmail compose takes one file handed over by the gateway`

### Task 8: Gmail descriptions, docs, registry pair, FD9 and FD10

**Files:**
- Modify: `plugins/gws-mcp/src/tools/gmail.ts`. The `attachmentsField` description and schema `items.anyOf` gain a file-reference object (`type` required, the six types), one per call. The `gmail_update_draft` description says a referenced file is dropped on the next update unless given again.
- Modify: `apps/gateway/content/docs/file-references.md`: a section "Attaching a file to an email".
- Create: `apps/gateway/src/gateway/tests/cases/fd9-content-on-a-draft.ts`, `fd10-two-references-refused.ts`, and register them.
- Create: the registry pair for the five Gmail rows (generated after merge, as in Task 4, Step 5).

**Interfaces:**
- **FD9** creates a draft as the sender with a 1 KB PNG `content` attachment and one fixture Drive file id. It reads the draft back with `gmail_read` and asserts a part of that size and name, then deletes the draft.
- **FD10** asserts the refusal text from Task 6.

- [ ] **Step 1: Descriptions.** gws-mcp suite. Expected: PASS.
- [ ] **Step 2: Cases and docs.** Cases unit tests and the content checks. Expected: PASS.
- [ ] **Step 3: Gate, then commit.** `feat: Gmail attachments by file reference, docs and runner cases`

---

## Phase 3: `file_upload_link`

### Task 9: The upload store

**Files:**
- Create: `apps/gateway/src/gateway/file-upload.ts`
- Create: `apps/gateway/src/gateway/file-upload.test.ts`

**Interfaces:**
- Produces:
  - `UPLOAD_TOOL = "file_upload_link"`, `UPLOAD_PATH = "/files/u/"`, `UPLOAD_LIFE_MS = 10 * 60_000`, `HELD_LIFE_MS = 10 * 60_000`;
  - `MAX_OPEN_UPLOADS_PER_USER = 3`, `MAX_UPLOAD_RECORDS_PER_USER = 40`, `MAX_UPLOAD_RECORDS_HOST = 10_000`, `MAX_HELD_UPLOAD_BYTES = 256 * 1024 * 1024`.
- Produces, the functions:
  - `createUploadLink(opts: { userId: string; args: Record<string, unknown> | undefined; baseUrl: string; now?: () => number }): CrossingResult`. Its receipt JSON is `{ link: { url, expires_at, uses: 1, command }, max_bytes, note }`, and the command is `curl -fsS -T <path-to-file> "<url>/"`.
  - `inspectUploadLink(token: string, now?: number): { kind: "live"; nameHint: string | null; maxBytes: number } | { kind: DeadUpload }`;
  - `beginReceive(token: string, now?: number): { ok: true; maxBytes: number; finish: (file: { bytes: Buffer; name: string; type: string } | null) => UploadReceipt | null } | { ok: false; kind: DeadUpload | "full" }`. `null` aborts back to `open`.
  - `takeUpload(uploadId: string, userId: string, now?: number): { ok: true; file: SourceFile; settle: (sent: boolean) => void } | { ok: false; text: string }`;
  - `dropUploadsForUser(userId: string): void`;
  - `revokeUploadLinksCarriedIn(userId: string, serialise: () => string, now?: number): boolean`;
  - `resetUploads(): void` (tests).
- Types:
  - `DeadUpload = "receiving" | "used" | "consumed" | "expired" | "cancelled" | "invalid"`;
  - `UploadReceipt = { received: { name; type; bytes; sha256 }; reference: { type: "upload"; upload_id: string }; held_until: string; note: string }`.
- Storage: `globalThis[Symbol.for("datatorag.file-upload.store")]`, the same pattern as `file-download.ts`. Reuse `percentUnescape` and the base64-needle approach by exporting `base64Needles` from `file-download.ts`.

- [ ] **Step 1: Write the failing tests.**
  - **Minting.** Mint answers a URL under `/files/u/` and a curl line with the trailing slash. A fourth open upload is refused ("You already have 3 upload links or uploaded files waiting. Use one, or wait for one to expire, then try again. No link was made.").
  - **Receiving.** `beginReceive` then `finish` gives a receipt whose `upload_id` is not the link nonce. A second `beginReceive` on the same token is `used`. A link past ten minutes is `expired`.
  - **The ceiling.** `full` when the held bytes plus `maxBytes` would pass 256 MB.
  - **Consuming.**
    - `takeUpload` by another user answers "This upload is not valid. Upload the file again." and leaves the record.
    - `settle(false)` returns it to received and it can be taken again; `settle(true)` drops the bytes and a later take says "has already been used".
    - Two concurrent takes: exactly one succeeds, and the other answers "This uploaded file is already being used by another call."
  - **Expiry.** A take after `heldUntil` answers "This uploaded file has expired. An uploaded file is kept ten minutes. Upload it again." A take that started before `heldUntil` and settles after it ends `consumed`, not `expired` (Review Focus 3).
  - **Revocation.** `dropUploadsForUser` drops held bytes. `revokeUploadLinksCarriedIn` cancels an `open` link whose nonce appears plain, percent-encoded or base64-encoded, and ignores a received upload's id.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** The module header states the corridor rule and the restart trade, mirroring `file-download.ts`'s: a restart drops every held file, and the refusal says to upload again. Extend `file-download.ts`'s process-local comment to name this store as the second one that must move to shared storage if the gateway ever runs as more than one process.
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(gateway): the upload link store`

### Task 10: The PUT route and the upload slot pool

**Files:**
- Modify: `apps/gateway/src/gateway/file-crossing.ts`. Add `upload` to `POOLS` (`MAX_UPLOADS_HOST = 2`) and export `withSlot(userId: string, pool: SlotPoolName, words: RefusalWords, run: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false; result: CrossingResult }>`.
- Create: `apps/gateway/src/gateway/file-upload-route.ts`
- Create: `apps/gateway/src/gateway/file-upload-route.test.ts`
- Modify: `apps/gateway/src/gateway/file-download-route.ts`. The `/files` handler hands `/u/...` paths to the upload handler, and `looksLikeDownloadPath` and `queryCarriesDownloadPath` also cover `/files/u/`.

**Interfaces:**
- Consumes: `beginReceive`, `inspectUploadLink` (Task 9); `cleanInboundName`, `typeForName` (Task 2).
- Produces: `handleUploadRequest(req: Request, res: Response, opts: { limits?: { deadlineMs?: number; stallMs?: number } }): Promise<void>`, with defaults of a 120 s deadline and a 15 s stall.
  - **Paths.** `/u/<token>` or `/u/<token>/<name>`, where the name segment is raw-percent-decoded once.
  - **Name, in order:** the `X-File-Name` header (percent-decoded), the path name, the hint, then `upload` plus the extension.
  - **GET** answers a plain sentence for live links in this task. The page arrives in Task 13.

- [ ] **Step 1: Write the failing tests** (real Express app on an ephemeral port).
  - A PUT of 70 bytes to `/files/u/<token>/a b.png` answers 200 with a receipt naming `a b.png`, 70 bytes and the right SHA-256.
  - A PUT with no name is stored as `upload` (Review Focus 4), and a name of only disallowed characters with `.png` becomes `upload.png`.
  - A PUT over `maxBytes` answers 413 "The file is larger than <n> MB, the most this link takes. Nothing was uploaded." and the link stays usable.
  - A stalled body is cut after the stall limit, and the link stays usable.
  - A PUT while the user has a crossing in flight answers 503 with the one-file sentence.
  - A third concurrent upload on the host answers 503 busy.
  - The responses carry the base headers, and no log line contains the token or name.
  - `/files%2Fu%2F<token>` is answered "not valid".
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.** Use the receiving loop's stall and deadline the way `sendBytes` does the send. The slot is released when the body ends, before the receipt is written.
- [ ] **Step 4: Run them and `file-download-route.test.ts`.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat(gateway): receive an uploaded file by PUT`

### Task 11: The tool, the `upload` reference, and "sent" from the plugins

**Files:**
- Modify: `apps/gateway/src/gateway/mcp-server.ts`:
  - a `BUILT_IN_TOOLS` entry for `file_upload_link` (flags in Global Constraints; description says one file, 25 MB, ten minutes, that the file does not enter the conversation, and that the next call names it with `{"type":"upload","upload_id":"..."}`);
  - the carried-link check also calls `revokeUploadLinksCarriedIn`.
- Modify: `apps/gateway/src/gateway/file-inbound.ts`: `resolveUpload`.
- Modify: `apps/gateway/src/gateway/file-crossing.ts`. A local `upload` reference is taken before the slot, settled after the send by the `sent` field, and settled `false` on every gateway refusal before `sendToDestination`.
- Modify: every caller of `dropLinksForUser`, so each also calls `dropUploadsForUser`. Find them with `git grep -n dropLinksForUser`.
- Modify: `plugins/gws-mcp/src/tools/drive-upload.ts`, `plugins/atlassian-mcp/src/tools/jira.ts` and the five Gmail paths. Every refusal returned before the service call carries `sent: false`, and `consume.ts` in both plugins passes `sent` through.
- Test: `file-crossing.test.ts`, `mcp-server.builtins.test.ts`, `mcp-server.file-crossing.test.ts`, the plugins' consume and tool tests.

**Interfaces:**
- Consumes: `takeUpload` (Task 9).
- Produces:
  - `resolveUpload(ref: FileReference, userId: string): { ok: true; file: SourceFile; settle: (sent: boolean) => void } | { ok: false; text: string }`;
  - the consume response body `{ content, isError, sent?: boolean }`. A missing `sent` is read as `true`.

- [ ] **Step 1: Write the failing tests.**
  - **Builtins.** The test enumerates the new entry with the three flags, and an `unattended` server does not list it.
  - **Bad folder.** Consuming an upload into Drive with a bad folder (plugin answers `sent:false`) leaves the upload takeable, and the second call with a good folder consumes it (Review Focus 2's sequential half).
  - **Unknown outcome.** A destination timeout consumes it.
  - **Busy slot.** A busy slot leaves it held.
  - **Carried links.** A tool call carrying the upload LINK is refused with "This call carries an upload link made by this service, and an upload link cannot be passed to another tool. The call was not run and the link has been cancelled."
  - **Sign-out.** It drops held uploads.
  - **Plugins.** Each pre-service refusal in `uploadReferencedFile` and `addJiraAttachment` carries `sent:false`, and a successful upload carries none.
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run the gateway `file-*` and `mcp-server*` tests and both plugin suites.** Expected: PASS.
- [ ] **Step 5: Commit.** `feat: file_upload_link and the upload reference`

### Task 12: Docs, registry pair, curl check, runner cases FD11 to FD16

**Files:**
- Modify: `apps/gateway/content/docs/file-references.md`:
  - the six-type table;
  - a section "Uploading a file from your computer", with the curl line;
  - "Where the file is" states that an uploaded file is held in memory for up to ten minutes, is never written to disk, and is gone once used or after a restart;
  - "Limits" gains 25 MB and three uploads at a time.
- Modify: the descriptions in `drive-upload.ts`, `jira.ts` and `gmail.ts` gain the `upload` type, with a registry pair after merge.
- Create: `apps/gateway/src/gateway/tests/upload-link.ts` (the runner's PUT helper, beside `download-link.ts`).
- Create: `apps/gateway/src/gateway/tests/cases/fd11-upload-into-drive.ts`, `fd12-upload-onto-jira.ts`, `fd13-upload-second-use.ts`, `fd14-upload-bad-folder-keeps-it.ts`, `fd15-upload-link-not-carried.ts`, `fd16-upload-oversize.ts`, and register them. Expiry is pinned by the unit tests in Task 9, not a ten-minute runner case.

- [ ] **Step 1: Verify the curl line by hand on macOS curl and on Linux curl** (a container is fine) against a local gateway, with the names `a.png`, `a b.png` and `résumé.pdf`. Record in the PR body which names arrived intact. If any did not, the command gains `-H "X-File-Name: <name>"` and Task 9's command string changes with it.
- [ ] **Step 2: Cases, the helper and docs.** Cases unit tests and the content checks. Expected: PASS.
- [ ] **Step 3: Gate, then commit.** `feat: upload link docs and runner cases`

---

## Phase 4: The drop page

### Task 13: The drop page

**Files:**
- Modify: `apps/gateway/src/gateway/file-upload-route.ts`. Add `uploadPage(opts: { nameHint: string | null; maxBytes: number; scriptNonce: string }): string`, and the GET for a live link serves it.
- Test: `apps/gateway/src/gateway/file-upload-route.test.ts`

**Interfaces:**
- Consumes: the PUT contract from Task 10 (`X-File-Name`, `X-File-Type`, and the JSON receipt).
- **The page:**
  - a file input, and a drop zone that also opens the picker on tap;
  - one Upload button;
  - the name and size before sending, and a progress bar from `XMLHttpRequest.upload.onprogress`;
  - on 200, the receipt and the reference with a Copy button;
  - on any other status, the route's sentence.
- **The CSP:** `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-<n>'; connect-src 'self'; form-action 'none'; frame-ancestors 'none'`, with a fresh nonce per response. The styling tokens are those of `downloadPage`.
- **Without scripts,** a `<noscript>` line names the curl way.

- [ ] **Step 1: Write the failing tests.**
  - GET on a live link answers 200 HTML with the CSP above, its `script-src` nonce equal to the `<script nonce>` in the body, and the hint escaped (`<b>` renders as text).
  - GET on a used or expired link answers the sentence.
  - The title is fixed text ("Upload file").
- [ ] **Step 2: Run them.** Expected: FAIL.
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run them.** Expected: PASS.
- [ ] **Step 5: Check it in a browser.** Use chrome-devtools (or the headless CDP harness when that profile is held elsewhere) at 1440 and 390, light and dark, with a real upload of a PNG against a local gateway. The receipt shows, and there is no sideways scroll at 390.
- [ ] **Step 6: FD17** (`fd17-upload-page.ts`): GET a minted link and assert the CSP and that the page names the upload. Gate, then commit. `feat(gateway): the upload drop page`

---

## After each phase ships

Each phase deploys on its own. After a deploy:
- run the registry pair for any changed plugin rows;
- write a changelog entry dated the deploy;
- after Phase 4, write the blog post through the content process.

None of these is part of a task's commit.
