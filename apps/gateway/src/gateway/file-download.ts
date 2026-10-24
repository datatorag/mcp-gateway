/**
 * SCRUM-420: a file reference to the user's own disk, by a link that works
 * once.
 *
 * `file_download_link` reads the referenced file, keeps its name, size and
 * SHA-256, lets go of the bytes and answers a link. Opening the link shows a
 * page with one button; the button (a POST) reads the file again, checks it
 * is the same file, and sends it. The file is in memory only while one of
 * those two reads runs, and is never written to disk.
 *
 * This module is the link store and the two reads. It knows nothing about
 * HTTP; the route is `file-download-route.ts`.
 *
 * What it must never do, and its tests pin:
 * - hold the bytes between the call and the click;
 * - send a byte of a file that no longer matches its receipt;
 * - let two requests both claim one link (check and claim share no await);
 * - put the token, the name or the hash in a log line or an event.
 *
 * UPLOAD LINKS ARE THE SECOND KIND OF RECORD HERE (SCRUM-437). An upload
 * link takes one file by PUT within ten minutes; the file is held in memory
 * for at most ten minutes from its arrival, under an upload id that a file
 * reference carries, and goes to one call. It is the one place a file is
 * held that is not mid-transfer, bounded by the held-bytes ceiling below,
 * and never written to disk. Both kinds share the sweeper, the per-user and
 * host caps, the revocation on a change of authority and the carried-link
 * check, because they share the records.
 *
 * THE KEY AND THE RECORDS LIVE IN THIS PROCESS, as the run-ownership key
 * does and for the same reason: production runs one gateway process, and a
 * restart costing every open link (ten minutes of them at most), and every
 * held upload, is cheaper than a long-lived secret or a file on disk. If the
 * gateway ever runs as more than one process, the records, the key and the
 * held uploads must move to shared storage with an atomic claim.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { totalmem } from "node:os";
import { safeStringEqual } from "@datatorag-mcp/auth";
import { forgetValue, redactValue } from "./log-redaction";
import {
  FILE_REFERENCE_TYPES,
  LOCAL_REFERENCE_TYPES,
  readReference,
  refuse,
  withReferencedFile,
  type CrossingResult,
  type FileReference,
  type ReferencedFileOptions,
  type RefusalWords,
} from "./file-crossing";

export const DOWNLOAD_TOOL = "file_download_link";
export const DOWNLOAD_PATH = "/files/d/";
export const UPLOAD_TOOL = "file_upload_link";
export const UPLOAD_PATH = "/files/u/";

export const LINK_LIFE_MS = 10 * 60_000;
/** How long a dead link's record is kept, so a late or second click can be
 * told what happened. A kept record holds no file content. */
export const LINK_KEPT_AFTER_MS = 10 * 60_000;
/** Set by the ordinary case: one email with three attachments and its
 * original is four links at once, and that several times in ten minutes. */
export const MAX_OPEN_LINKS_PER_USER = 10;
/** Records of any state for one user, so minting and spending in a loop
 * cannot fill the store. */
export const MAX_RECORDS_PER_USER = 40;
/** There only to bound memory: a record is a few hundred bytes. A low
 * ceiling here would let a handful of accounts lock the tool for everyone. */
export const MAX_RECORDS_HOST = 10_000;

/** An uploaded file is held this long from its arrival, then dropped. */
export const HELD_LIFE_MS = 10 * 60_000;
/** Upload links and held uploads one user may have at once. */
export const MAX_OPEN_UPLOADS_PER_USER = 3;
/** The largest file an upload link takes, and the default. */
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
/** Files held, and room reserved for files arriving, across the host. Ten
 * full-size uploads at once. */
export const MAX_HELD_UPLOAD_BYTES = 256 * 1024 * 1024;

/**
 * Refuses to start a gateway whose held uploads could take more than a
 * quarter of the machine's memory, so the ceiling cannot outgrow the host it
 * runs on. Called once at startup.
 */
export function assertHeldUploadCeiling(machineBytes: number = totalmem()): void {
  if (MAX_HELD_UPLOAD_BYTES > machineBytes / 4) {
    throw new Error(
      `Held uploads may take ${MAX_HELD_UPLOAD_BYTES} bytes, more than a quarter of this machine's ${machineBytes}; lower MAX_HELD_UPLOAD_BYTES.`
    );
  }
}

const LINK_WORDS: RefusalWords = {
  clause: "no link was made",
  sentence: "No link was made.",
  busy: "Nothing was read and no link was made",
};
const SEND_WORDS: RefusalWords = {
  clause: "nothing was sent",
  sentence: "Nothing was sent.",
  busy: "Nothing was sent",
};

/** The type a download is sent with. Ours for a message; for anything else
 * a fixed opaque type, never the one the sender of an email declared. */
const DOWNLOAD_TYPE: Readonly<Record<string, string>> = { gmail_message: "message/rfc822" };

/** A Drive export's type is the format the caller asked for, so it is ours
 * rather than an uploader's, and a download carries it. HTML, and the zip a
 * Sheet's HTML comes as, are left out: a page is the one type a browser
 * would do something with besides save it. A stored Drive file keeps the
 * opaque type, because its declared type is whoever uploaded it's word. */
const EXPORT_DOWNLOAD_TYPE: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  odt: "application/vnd.oasis.opendocument.text",
  ods: "application/vnd.oasis.opendocument.spreadsheet",
  odp: "application/vnd.oasis.opendocument.presentation",
  epub: "application/epub+zip",
  rtf: "application/rtf",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  md: "text/markdown",
};

export function downloadType(ref: FileReference): string {
  if (ref.type === "drive_export" && typeof ref.format === "string" && Object.hasOwn(EXPORT_DOWNLOAD_TYPE, ref.format)) {
    return EXPORT_DOWNLOAD_TYPE[ref.format];
  }
  return Object.hasOwn(DOWNLOAD_TYPE, ref.type) ? DOWNLOAD_TYPE[ref.type] : "application/octet-stream";
}

/** `open` and `sending` are alive; the rest say how the link ended. */
type LinkState = "open" | "sending" | "used" | "changed" | "cancelled";

type DownloadRecord = {
  kind: "download";
  nonce: string;
  userId: string;
  /** Closed to its type's fields, plus the account when one was named. */
  ref: FileReference;
  name: string;
  bytes: number;
  sha256: string;
  expiresAt: number;
  state: LinkState;
};

/** `open` takes a PUT, `receiving` is one, `received` holds the file,
 * `consuming` is handing it to a call. The rest say how it ended. */
type UploadState = "open" | "receiving" | "received" | "consuming" | "consumed" | "expired" | "cancelled";

type UploadRecord = {
  kind: "upload";
  nonce: string;
  userId: string;
  /** What a file reference names the file by. Not the nonce: a call that
   * uses the file carries this id, and the carried-link check cancels any
   * link whose nonce a call carries. */
  uploadId: string;
  nameHint: string | null;
  maxBytes: number;
  /** When the link stops taking a PUT. */
  expiresAt: number;
  /** When a received file is dropped. */
  heldUntil?: number;
  state: UploadState;
  file?: { bytes: Buffer<ArrayBuffer>; name: string; type: string; sha256: string };
};

type LinkRecord = DownloadRecord | UploadRecord;

/**
 * ONE STORE PER PROCESS, NOT PER MODULE INSTANCE. The gateway process loads
 * this file twice: once in the server bundle, which serves `/mcp` and the
 * download route, and once in the app bundle, where the agent's in-process
 * MCP server runs. A link minted in one must be found by the other, so the
 * key and the records hang off `globalThis` under a registered symbol.
 */
type Store = {
  key: Buffer;
  records: Map<string, LinkRecord>;
  byUser: Map<string, Set<LinkRecord>>;
  byUploadId?: Map<string, UploadRecord>;
  sweeper?: ReturnType<typeof setInterval>;
};
const STORE = Symbol.for("datatorag.file-download.store");
const store: Store = ((globalThis as Record<symbol, unknown>)[STORE] as Store | undefined) ??
  ((globalThis as Record<symbol, unknown>)[STORE] = {
    key: randomBytes(32),
    records: new Map(),
    byUser: new Map(),
  } satisfies Store);
store.byUploadId ??= new Map();
const { records, byUser } = store;
const byUploadId = store.byUploadId;

// Lapsed records are dropped on a timer, so what is kept about a file is
// gone when the docs say it is even if nobody touches the service. Once per
// process, whichever bundle loads this file first.
if (!store.sweeper) {
  store.sweeper = setInterval(() => sweep(Date.now()), 60_000);
  store.sweeper.unref?.();
}

/** Forgets every link and changes the key, as a restart does. For tests. */
export function resetDownloadLinks(): void {
  for (const record of [...records.values()]) drop(record);
  store.key = randomBytes(32);
  records.clear();
  byUser.clear();
  byUploadId.clear();
}

/** How many records are held, for tests and nothing else. */
export function downloadLinksHeld(): number {
  return records.size;
}

/** The reference as the record and the tag see it: its type, the fields the
 * type declares, and the account. Nothing else the caller put on it. */
function closedReference(ref: FileReference): FileReference {
  const out: FileReference = { type: ref.type };
  for (const field of FILE_REFERENCE_TYPES[ref.type].requiredStrings) out[field] = ref[field];
  if (typeof ref.account === "string") out.account = ref.account;
  return out;
}

function tagFor(r: LinkRecord): string {
  // NUL-separated, so no field can run into the next and collide. The kind
  // comes first, so a token of one kind never names a record of the other.
  const parts =
    r.kind === "upload"
      ? ["upload", r.nonce, r.userId, String(r.maxBytes), String(r.expiresAt)]
      : [
          "download",
          r.nonce,
          r.userId,
          r.ref.type,
          ...FILE_REFERENCE_TYPES[r.ref.type].requiredStrings.map((f) => String(r.ref[f])),
          r.ref.account ?? "",
          r.sha256,
          String(r.expiresAt),
        ];
  return createHmac("sha256", store.key).update(parts.join("\u0000")).digest("base64url");
}

function drop(record: LinkRecord): void {
  forgetValue(record.nonce);
  forgetValue(tagFor(record));
  records.delete(record.nonce);
  if (record.kind === "upload") {
    record.file = undefined;
    byUploadId.delete(record.uploadId);
  }
  const mine = byUser.get(record.userId);
  mine?.delete(record);
  if (mine?.size === 0) byUser.delete(record.userId);
}

function sweep(now: number): void {
  for (const record of records.values()) {
    if (record.kind === "download") {
      if (now >= record.expiresAt + LINK_KEPT_AFTER_MS) drop(record);
      continue;
    }
    // A link that took no file lapses with the link; a held file lapses ten
    // minutes after it arrived. A file being handed to a call is left to
    // that call, which settles it.
    if (record.state === "open" && now >= record.expiresAt) record.state = "expired";
    if (record.state === "received" && now >= (record.heldUntil ?? 0)) {
      record.state = "expired";
      record.file = undefined;
    }
    const ended = record.heldUntil ?? record.expiresAt;
    const settled = record.state !== "receiving" && record.state !== "consuming";
    if (settled && now >= ended + LINK_KEPT_AFTER_MS) drop(record);
  }
}

const userRecords = (userId: string): LinkRecord[] => [...(byUser.get(userId) ?? [])];

/** A link that would still do something if used: what the carried-link
 * check guards. A received upload's link is spent; its file is named by an
 * upload id, which is not a link. */
const isLive = (r: LinkRecord, now: number) =>
  r.kind === "upload"
    ? r.state === "open" && now < r.expiresAt
    : (r.state === "open" || r.state === "sending") && now < r.expiresAt;

/** An upload that still counts against its user: a link not yet used, or a
 * file arriving, held or being handed over. */
const uploadPending = (r: LinkRecord, now: number) =>
  r.kind === "upload" &&
  ((r.state === "open" && now < r.expiresAt) || r.state === "receiving" || r.state === "received" || r.state === "consuming");

/** Why a link cannot be minted right now, in words, or null. */
function capRefusal(userId: string, now: number, kind: LinkRecord["kind"] = "download"): string | null {
  sweep(now);
  const mine = userRecords(userId);
  if (kind === "upload" && mine.filter((r) => uploadPending(r, now)).length >= MAX_OPEN_UPLOADS_PER_USER) {
    return `You already have ${MAX_OPEN_UPLOADS_PER_USER} upload links or uploaded files waiting. Use one, or wait for one to expire, then try again. No link was made.`;
  }
  if (kind === "download" && mine.filter((r) => r.kind === "download" && isLive(r, now)).length >= MAX_OPEN_LINKS_PER_USER) {
    return `You already have ${MAX_OPEN_LINKS_PER_USER} download links that have not been used. Use one, or wait for one to expire, then try again. No link was made.`;
  }
  if (mine.length >= MAX_RECORDS_PER_USER) {
    return `You have made ${MAX_RECORDS_PER_USER} download links in a short time. Wait a few minutes for the oldest to lapse, then try again. No link was made.`;
  }
  if (records.size >= MAX_RECORDS_HOST) {
    return "The service is holding as many download links as it can right now. No link was made; try again in a few minutes.";
  }
  return null;
}

const TOKEN = /^([A-Za-z0-9_-]{22})\.([A-Za-z0-9_-]{43})$/;

/** The record a token names, or null. The tag is recomputed from the
 * record's own fields and compared in constant time, so a record is only
 * honoured for the token it was minted with. */
function recordFor(token: string): LinkRecord | null {
  const m = TOKEN.exec(token);
  const record = m && records.get(m[1]);
  return record && safeStringEqual(tagFor(record), m[2]) ? record : null;
}

/** Why a link is not usable: what a click on it is told. */
export type DeadLink = "sending" | "used" | "changed" | "cancelled" | "expired" | "invalid";

/** What a link is, to anyone who asks without spending it. */
export type LinkStatus = { kind: "live"; name: string; bytes: number } | { kind: DeadLink };

function statusOf(record: LinkRecord | null, now: number): LinkStatus {
  if (!record || record.kind !== "download" || records.get(record.nonce) !== record) return { kind: "invalid" };
  if (record.state !== "open") return { kind: record.state };
  if (now >= record.expiresAt) return { kind: "expired" };
  return { kind: "live", name: record.name, bytes: record.bytes };
}

/** A GET: what the page shows. Spends nothing. */
export function inspectLink(token: string, now: number = Date.now()): LinkStatus {
  sweep(now);
  return statusOf(recordFor(token), now);
}

/**
 * Drops every link of a user. Called when the user's authority changes
 * (sign-out, a revoked key or grant, a disconnected account), so a link
 * minted before does not outlive it.
 */
export function dropLinksForUser(userId: string): void {
  for (const record of userRecords(userId)) drop(record);
}

/** `%41` and its kind, each escape on its own. Not decodeURIComponent over
 * the whole text: one stray "%" elsewhere would make that throw, and a
 * check that a stray character switches off is not a check. */
export const percentUnescape = (text: string) =>
  text.replace(/%([0-9A-Fa-f]{2})/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));

/**
 * How a nonce reads inside base64 text, at each of the three positions it
 * can fall on. The characters that depend on what comes before or after it
 * are cut, so what is left is in the encoding of ANY text holding the
 * nonce. Both alphabets.
 *
 * Needles, not decoding: the text searched is a tool call's arguments,
 * which can be megabytes of someone's attachment, and it is searched as it
 * is rather than copied and decoded.
 */
function base64Needles(nonce: string): string[] {
  const needles: string[] = [];
  for (let lead = 0; lead < 3; lead++) {
    const encoded = Buffer.from("\0".repeat(lead) + nonce, "latin1").toString("base64").replace(/=+$/, "");
    // A character is ours alone only if all six of its bits are.
    const start = Math.ceil((lead * 8) / 6);
    const end = Math.floor(((lead + nonce.length) * 8) / 6);
    const standard = encoded.slice(start, end);
    needles.push(standard, standard.replace(/\+/g, "-").replace(/\//g, "_"));
  }
  return needles;
}

/**
 * The gateway refuses to carry its own link (the exfiltration control).
 *
 * True when a tool call's arguments contain the nonce of one of this user's
 * live links, as given, percent-encoded or base64-encoded; that link is
 * then cancelled. The match is on the nonce, not the download path: the
 * path is public, and a token sent without it can be put back together by
 * whoever receives it.
 *
 * `serialise` is called only when the user has a live link, so a user
 * without one pays a map lookup and no more on every tool call.
 *
 * WHAT IT DOES NOT DO: a token split, reversed or encoded some other way
 * passes, as does base64 wrapped across lines inside the nonce, and so does
 * anything a client sends with a tool that is not ours.
 */
export function revokeLinksCarriedIn(userId: string, serialise: () => string, now: number = Date.now()): boolean {
  const live = userRecords(userId).filter((r) => isLive(r, now));
  if (live.length === 0) return false;
  const text = serialise();
  const haystacks = text.includes("%") ? [text, percentUnescape(text)] : [text];
  let carried = false;
  for (const record of live) {
    const needles = [record.nonce, ...base64Needles(record.nonce)];
    if (haystacks.some((h) => needles.some((n) => h.includes(n)))) {
      record.state = "cancelled";
      carried = true;
    }
  }
  return carried;
}

const RESERVED_DEVICE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * The name a download is saved under. The source plugin already cleaned it;
 * this route does not take that on trust, because the name goes into a
 * header, a page and, through the receipt's command, a directory on the
 * user's machine. No control or direction characters, no quotes or path
 * separators, no leading dots (so not `.npmrc`), no trailing dots or
 * spaces, not a reserved device name. What cannot be kept becomes
 * `download` plus the extension.
 */
export function safeDownloadName(name: string): string {
  const cleaned = name
    .replace(/[\p{Cc}\p{Cf}]/gu, "")
    .replace(/["'`\\/:*?<>|]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[. ]+/, "")
    .replace(/[. ]+$/, "")
    .toWellFormed();
  if (cleaned && !RESERVED_DEVICE.test(cleaned)) return cleaned;
  const ext = /\.[A-Za-z0-9]{1,10}$/.exec(name.replace(/[. ]+$/, ""))?.[0] ?? "";
  return `download${ext}`;
}

export type DownloadDeps = Pick<
  ReferencedFileOptions,
  "resolveToken" | "resolvePluginUrl" | "surface" | "connectionsUrl" | "fetchFn" | "timeoutMs"
>;

const sha256Of = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

/**
 * The tool. Reads the referenced file once to know its size and SHA-256,
 * lets go of it, and answers a receipt carrying a link.
 */
export async function createDownloadLink(opts: {
  userId: string;
  args: Record<string, unknown> | undefined;
  /** Absolute origin of this gateway; the link is on it. */
  baseUrl: string;
  deps: DownloadDeps;
  now?: () => number;
}): Promise<CrossingResult> {
  const now = opts.now ?? Date.now;
  // A link re-reads its source at the click; a file the caller holds has no
  // source to re-read (SCRUM-437).
  const given = (opts.args ?? {}).file as { type?: unknown } | undefined;
  if (given && typeof given === "object" && typeof given.type === "string" && Object.hasOwn(LOCAL_REFERENCE_TYPES, given.type)) {
    return refuse("This file is already on your side; a download link is for files in a connected service. No link was made.");
  }
  const read = readReference(opts.args ?? {}, "file", DOWNLOAD_TOOL, { local: false });
  if (!read.ok) return refuse(read.text);
  if (!/^https?:\/\//.test(opts.baseUrl)) {
    return refuse("A download link cannot be made here: this service does not know its own address. No link was made.");
  }

  // Before the read, so a user at a cap does not cost a read to be told so.
  const early = capRefusal(opts.userId, now());
  if (early) return refuse(early);

  const ref = closedReference(read.ref);
  const measured = await withReferencedFile(
    { ...opts.deps, userId: opts.userId, ref, pool: "transfer", words: LINK_WORDS },
    async (file) => ({
      name: safeDownloadName(file.name),
      type: file.type,
      bytes: file.bytes.byteLength,
      sha256: sha256Of(file.bytes),
    })
  );
  if (!measured.ok) return measured.result;
  const file = measured.value;

  // Again, with no await between this check and the insert below: the read
  // above was one, and another call of this user's may have minted since.
  const at = now();
  const late = capRefusal(opts.userId, at);
  if (late) return refuse(late);

  const record: DownloadRecord = {
    kind: "download",
    nonce: randomBytes(16).toString("base64url"),
    userId: opts.userId,
    ref,
    name: file.name,
    bytes: file.bytes,
    sha256: file.sha256,
    expiresAt: at + LINK_LIFE_MS,
    state: "open",
  };
  records.set(record.nonce, record);
  if (!byUser.has(opts.userId)) byUser.set(opts.userId, new Set());
  byUser.get(opts.userId)!.add(record);

  const tag = tagFor(record);
  // Neither half is ever written to the process's output while the record
  // is held, whatever prints it and whatever touches it.
  redactValue(record.nonce);
  redactValue(tag);
  const url = `${opts.baseUrl.replace(/\/+$/, "")}${DOWNLOAD_PATH}${record.nonce}.${tag}`;
  const receipt = {
    file: { name: file.name, type: file.type },
    sent: { bytes: file.bytes, sha256: file.sha256 },
    link: {
      url,
      expires_at: new Date(record.expiresAt).toISOString(),
      uses: 1,
      // The name cannot close the label and open a second link.
      markdown: `[Download ${file.name.replace(/[[\]()]/g, " ")}](${url})`,
      // -f: a refusal saves nothing. The token needs no quoting.
      command: `curl -f -X POST -OJ ${url}`,
    },
    note: "The link opens a page with one button that saves the file. It works once and stops working after ten minutes. The command saves the file under the sender's name in the current directory. The file was not placed in this conversation.",
  };
  return { content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }] };
}

/** A file on its way out. */
export type SendingFile = { kind: "send"; name: string; type: string; bytes: Buffer<ArrayBuffer>; userId: string };

/** What a POST came to. `busy` and `source` read or sent nothing and leave
 * the link open. */
export type RedeemOutcome = SendingFile | { kind: DeadLink | "busy" | "source" };

/**
 * A POST: claims the link, reads the file again and, only if it is the file
 * the receipt described, hands the bytes to `send` while the download slot
 * is still held. The link is spent from the moment `send` is called, whether
 * or not the browser finishes.
 *
 * A failed read leaves the link open until it expires. Failed reads are not
 * counted: the one slot per user and the ten minute life already bound how
 * often a link can make the gateway read a file.
 */
export async function redeemDownloadLink(
  token: string,
  deps: (userId: string) => DownloadDeps,
  send: (file: SendingFile) => Promise<void>,
  now: () => number = Date.now
): Promise<RedeemOutcome> {
  sweep(now());
  const record = recordFor(token);
  const status = statusOf(record, now());
  if (!record || record.kind !== "download" || status.kind !== "live") return { kind: status.kind as DeadLink };
  // Claimed, with no await since the check.
  record.state = "sending";
  /** The state as it is NOW: every await below is a chance for the link to
   * be cancelled or dropped, and the claim above narrowed the type. */
  const stateNow = (): LinkState => record.state;

  let outcome: RedeemOutcome;
  try {
    const result = await withReferencedFile(
      { ...deps(record.userId), userId: record.userId, ref: record.ref, pool: "download", words: SEND_WORDS },
      async (file): Promise<RedeemOutcome> => {
        // A link cancelled or dropped while the read ran (carried in a tool
        // call, a sign-out, a disconnect) sends nothing.
        const after = statusOf(record, now());
        if (after.kind !== "sending") return { kind: after.kind as DeadLink };
        if (file.bytes.byteLength !== record.bytes || sha256Of(file.bytes) !== record.sha256) {
          return { kind: "changed" };
        }
        const sending: SendingFile = {
          kind: "send",
          name: record.name,
          type: downloadType(record.ref),
          bytes: file.bytes,
          userId: record.userId,
        };
        record.state = "used";
        await send(sending);
        return sending;
      }
    );
    outcome = result.ok ? result.value : { kind: result.reason };
  } catch {
    // `send` threw after the link was used: the response is already under
    // way. Anything else is a read that failed somewhere of ours.
    outcome = { kind: stateNow() === "used" ? "used" : "source" };
  }

  // The state is only ours to change while it is still the claim made
  // above. A failed read must not reopen a link something else has closed.
  if (stateNow() === "sending") record.state = outcome.kind === "changed" ? "changed" : "open";
  return outcome;
}

// ---------------------------------------------------------------------------
// Upload links (SCRUM-437)
// ---------------------------------------------------------------------------

/** Why an upload link cannot take a file. */
export type DeadUpload = "receiving" | "used" | "expired" | "cancelled" | "invalid";

/** What an upload link is, to anyone who asks without using it. */
export type UploadStatus = { kind: "live"; nameHint: string | null; maxBytes: number } | { kind: DeadUpload };

/** What a received file's PUT answers: the receipt, and the reference a
 * call names the file by. */
export type UploadReceipt = {
  received: { name: string; type: string; bytes: number; sha256: string };
  reference: { type: "upload"; upload_id: string };
  held_until: string;
  note: string;
};

function uploadFor(token: string): UploadRecord | null {
  const record = recordFor(token);
  return record && record.kind === "upload" ? record : null;
}

function uploadStatus(record: UploadRecord | null, now: number): UploadStatus {
  if (!record || records.get(record.nonce) !== record) return { kind: "invalid" };
  if (record.state === "cancelled") return { kind: "cancelled" };
  if (record.state === "receiving") return { kind: "receiving" };
  if (record.state !== "open") return { kind: record.state === "expired" && !record.heldUntil ? "expired" : "used" };
  if (now >= record.expiresAt) return { kind: "expired" };
  return { kind: "live", nameHint: record.nameHint, maxBytes: record.maxBytes };
}

/** A GET of an upload link: what it is. Spends nothing. */
export function inspectUploadLink(token: string, now: number = Date.now()): UploadStatus {
  sweep(now);
  return uploadStatus(uploadFor(token), now);
}

/** Bytes of held files, and of room reserved for files arriving. */
function heldAndReserved(): number {
  let total = 0;
  for (const record of byUploadId.values()) {
    if (record.state === "receiving") total += record.maxBytes;
    else if (record.file) total += record.file.bytes.byteLength;
  }
  return total;
}

/**
 * The tool. Answers a link that takes one file by PUT within ten minutes,
 * and the one-line command that sends it. Nothing is read or held yet.
 */
export function createUploadLink(opts: {
  userId: string;
  args: Record<string, unknown> | undefined;
  baseUrl: string;
  now?: () => number;
}): CrossingResult {
  const now = opts.now ?? Date.now;
  const args = opts.args ?? {};
  if (!/^https?:\/\//.test(opts.baseUrl)) {
    return refuse("An upload link cannot be made here: this service does not know its own address. No link was made.");
  }
  if (args.name !== undefined && (typeof args.name !== "string" || args.name.length > 200)) {
    return refuse("name must be a file name of at most 200 characters. No link was made.");
  }
  const maxBytes = args.max_bytes === undefined ? MAX_UPLOAD_BYTES : args.max_bytes;
  if (typeof maxBytes !== "number" || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_UPLOAD_BYTES) {
    return refuse(`max_bytes must be a whole number of bytes from 1 to ${MAX_UPLOAD_BYTES} (25 MB). No link was made.`);
  }

  const at = now();
  const refusal = capRefusal(opts.userId, at, "upload");
  if (refusal) return refuse(refusal);

  const record: UploadRecord = {
    kind: "upload",
    nonce: randomBytes(16).toString("base64url"),
    userId: opts.userId,
    uploadId: randomBytes(16).toString("base64url"),
    nameHint: typeof args.name === "string" && args.name !== "" ? args.name : null,
    maxBytes,
    expiresAt: at + LINK_LIFE_MS,
    state: "open",
  };
  records.set(record.nonce, record);
  byUploadId.set(record.uploadId, record);
  if (!byUser.has(opts.userId)) byUser.set(opts.userId, new Set());
  byUser.get(opts.userId)!.add(record);

  const tag = tagFor(record);
  redactValue(record.nonce);
  redactValue(tag);
  const url = `${opts.baseUrl.replace(/\/+$/, "")}${UPLOAD_PATH}${record.nonce}.${tag}`;
  const receipt = {
    link: {
      url,
      expires_at: new Date(record.expiresAt).toISOString(),
      uses: 1,
      // -T is a PUT of the file; the trailing slash makes curl append the
      // file's own name; -f makes a refusal fail the command.
      command: `curl -fsS -T <path-to-file> "${url}/"`,
    },
    max_bytes: maxBytes,
    note:
      "The link takes one file, once, within ten minutes: run the command with the path of the file in place of <path-to-file>. " +
      'It answers a receipt with the file\'s size and SHA-256 and a reference, {"type":"upload","upload_id":"..."}, to pass to drive_upload_file, jira_add_attachment or an email\'s attachments. ' +
      "The file is held for ten minutes after it arrives and goes to one call. It is not placed in this conversation.",
  };
  return { content: [{ type: "text", text: JSON.stringify(receipt, null, 2) }] };
}

/**
 * A PUT: claims the link for one file and reserves room for it. `finish`
 * with the file holds it and answers the receipt; with null it gives the
 * link back. Check and claim share no await.
 */
export function beginReceive(
  token: string,
  now: number = Date.now()
):
  | { ok: true; maxBytes: number; finish: (file: { bytes: Buffer<ArrayBuffer>; name: string; type: string } | null, at?: number) => UploadReceipt | null }
  | { ok: false; kind: DeadUpload | "full" } {
  sweep(now);
  const record = uploadFor(token);
  const status = uploadStatus(record, now);
  if (!record || status.kind !== "live") return { ok: false, kind: status.kind as DeadUpload };
  if (heldAndReserved() + record.maxBytes > MAX_HELD_UPLOAD_BYTES) return { ok: false, kind: "full" };
  record.state = "receiving";
  return {
    ok: true,
    maxBytes: record.maxBytes,
    finish: (file, at = Date.now()) => {
      // Dropped or cancelled while the file was arriving: nothing is kept.
      if (records.get(record.nonce) !== record || record.state !== "receiving") return null;
      if (!file) {
        record.state = "open";
        return null;
      }
      const sha256 = createHash("sha256").update(file.bytes).digest("hex");
      record.file = { ...file, sha256 };
      record.heldUntil = at + HELD_LIFE_MS;
      record.state = "received";
      return {
        received: { name: file.name, type: file.type, bytes: file.bytes.byteLength, sha256 },
        reference: { type: "upload", upload_id: record.uploadId },
        held_until: new Date(record.heldUntil).toISOString(),
        note: "Pass the reference as the file of drive_upload_file or jira_add_attachment, or as an entry of an email's attachments. It works once, within ten minutes.",
      };
    },
  };
}

/**
 * A call that names an uploaded file: hands it to its owner's call and holds
 * it as being used, so a second call cannot take it too. `settle(true)`
 * once the destination was asked (the file is then spent, whatever the
 * answer); `settle(false)` when the call stopped first, and it waits again.
 */
export function takeUpload(
  uploadId: string,
  userId: string,
  now: number = Date.now()
): { ok: true; file: { bytes: Buffer<ArrayBuffer>; name: string; type: string }; settle: (requested: boolean) => void } | { ok: false; text: string } {
  sweep(now);
  const record = byUploadId.get(uploadId);
  if (!record || record.userId !== userId || records.get(record.nonce) !== record) {
    return { ok: false, text: "This upload is not valid. Upload the file again." };
  }
  switch (record.state) {
    case "consuming":
      return { ok: false, text: "This uploaded file is already being used by another call." };
    case "consumed":
      return { ok: false, text: "This uploaded file has already been used. An uploaded file goes to one call. Upload it again." };
    case "expired":
      return { ok: false, text: "This uploaded file has expired. An uploaded file is kept ten minutes. Upload it again." };
    case "cancelled":
      return { ok: false, text: "This upload link was cancelled because it was passed to another tool. Upload the file again." };
    case "open":
    case "receiving":
      return { ok: false, text: "This file has not finished arriving. Finish the upload, then try again." };
  }
  const file = record.file;
  if (!file) return { ok: false, text: "This upload is not valid. Upload the file again." };
  record.state = "consuming";
  let settled = false;
  return {
    ok: true,
    file: { bytes: file.bytes, name: file.name, type: file.type },
    settle: (requested) => {
      if (settled) return;
      settled = true;
      if (records.get(record.nonce) !== record || record.state !== "consuming") return;
      if (requested) {
        record.state = "consumed";
        record.file = undefined;
      } else {
        record.state = "received";
      }
    },
  };
}
