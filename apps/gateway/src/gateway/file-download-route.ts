/**
 * SCRUM-420: the HTTP side of a download link. `/files/d/<token>`.
 *
 * THE LINK IS THE CREDENTIAL. There is no sign-in here and no cookie is
 * read. That is a ruling, not an omission: the user is already signed in to
 * the gateway through their MCP client, and the link is single use, short
 * lived and bound to one user and one file.
 *
 * GET SHOWS A PAGE AND SPENDS NOTHING. POST SENDS THE FILE. Mail scanners,
 * chat previews and link checkers fetch a URL with a plain GET and do not
 * say what they are. If a GET spent the link, any of them would take the
 * file and leave the user with "already used". The page's one button makes
 * the POST, and so can a client with a command line.
 *
 * NOTHING ABOUT THE FILE OR THE LINK IS LOGGED: one line per request with
 * the method, the outcome and a byte count. The token is in the path, so
 * this route never prints `req.url`.
 */

import { Router, type Request, type Response } from "express";
import type { Database } from "@datatorag-mcp/db";
import { sourceResolversFor } from "./file-source";
import {
  DOWNLOAD_PATH,
  inspectLink,
  percentUnescape,
  redeemDownloadLink,
  type DeadLink,
  type DownloadDeps,
  type RedeemOutcome,
} from "./file-download";
import type { Surface } from "./scope-grant";

/** What a reader of a referenced file needs, for one user. The tool and
 * this route build it the same way, so a link is read on the click exactly
 * as it was read at the call. */
export function downloadDepsFor(
  db: Database,
  userId: string,
  surface: Surface,
  connectionsUrl: string
): DownloadDeps {
  return { ...sourceResolversFor(db, userId), surface, connectionsUrl };
}

/** Everything under here is this router's, matched or not. */
const DOWNLOAD_PREFIX = DOWNLOAD_PATH.replace(/\/d\/$/, "");

/** Most to write a response, start to end. */
export const SEND_DEADLINE_MS = 120_000;
/** A reader that does not take one chunk in this long is cut. */
export const SEND_STALL_MS = 10_000;
const SEND_CHUNK = 64 * 1024;

const NEW_ONE = "Ask for a new one in your conversation.";

/** Every answer that is not the file or the page: a status and one sentence. */
const SENTENCES: Record<DeadLink | "busy" | "source", { status: number; text: string }> = {
  used: { status: 410, text: `This download link has already been used. A link works once. ${NEW_ONE}` },
  cancelled: {
    status: 410,
    text: `This download link was cancelled because it was passed to another tool. ${NEW_ONE}`,
  },
  sending: { status: 409, text: "This download is already in progress." },
  expired: { status: 410, text: `This download link has expired. A link lasts ten minutes. ${NEW_ONE}` },
  invalid: { status: 404, text: `This download link is not valid. ${NEW_ONE}` },
  changed: {
    status: 409,
    text: "The file has changed at its source since this link was made, so nothing was sent. Ask for a new link.",
  },
  source: { status: 502, text: "The file could not be read from its source. Nothing was sent. Try the link again." },
  busy: {
    status: 503,
    text: "The service is busy moving other files. Nothing was sent. Try the link again in a minute.",
  },
};

/** On every answer of this route, whatever it is. */
function baseHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function sentence(res: Response, kind: keyof typeof SENTENCES): void {
  const { status, text } = SENTENCES[kind];
  baseHeaders(res);
  if (kind === "busy") res.setHeader("Retry-After", "30");
  res.status(status).type("text/plain; charset=utf-8").send(text);
}

const escapeHtml = (text: string) =>
  text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function sizeWords(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The page: the name, the size and one button. No script. The title is
 * fixed text, so a previewer that copies titles copies nothing about the
 * file. */
export function downloadPage(name: string, bytes: number): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Save file</title>
<style>
body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;min-height:100vh;place-items:center;background:#f6f7f9;color:#14171f}
main{max-width:28rem;margin:1rem;padding:2rem;background:#fff;border:1px solid #dde1e8;border-radius:12px}
h1{font-size:1.125rem;margin:0 0 .25rem;overflow-wrap:anywhere}
p{margin:.25rem 0 1.25rem;color:#4a5263}
button{font:inherit;font-weight:600;padding:.625rem 1.25rem;border:0;border-radius:8px;background:#14171f;color:#fff;cursor:pointer}
small{display:block;margin-top:1.25rem;color:#4a5263}
</style>
</head>
<body>
<main>
<h1>${escapeHtml(name)}</h1>
<p>${escapeHtml(sizeWords(bytes))}</p>
<form method="post"><button type="submit">Save file</button></form>
<small>This link saves the file once and stops working ten minutes after it was made.</small>
</main>
</body>
</html>
`;
}

/** RFC 6266: an ASCII fallback and the real name, percent-encoded. */
export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_");
  const encoded = encodeURIComponent(name).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * Writes the bytes, never waiting on a slow reader past the limits. The
 * file sits in memory and a download slot is held for as long as this runs,
 * and the other end sets the pace, so the wait is bounded here: a reader
 * that takes less than one chunk in SEND_STALL_MS, or the whole file in more
 * than SEND_DEADLINE_MS, is cut off.
 */
export async function sendBytes(
  res: Pick<Response, "write" | "end" | "once" | "off" | "destroy">,
  bytes: Buffer,
  limits: { deadlineMs?: number; stallMs?: number; chunk?: number } = {}
): Promise<"sent" | "cut"> {
  const deadlineMs = limits.deadlineMs ?? SEND_DEADLINE_MS;
  const stallMs = limits.stallMs ?? SEND_STALL_MS;
  const chunk = limits.chunk ?? SEND_CHUNK;
  const startedAt = Date.now();
  let closed = false;
  const onClose = () => {
    closed = true;
  };
  res.once("close", onClose);
  try {
    for (let offset = 0; offset < bytes.length; offset += chunk) {
      if (closed) return "cut";
      const flushed = res.write(bytes.subarray(offset, offset + chunk));
      if (flushed) continue;
      const left = deadlineMs - (Date.now() - startedAt);
      const drained = await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => done(false), Math.max(0, Math.min(stallMs, left)));
        const onDrain = () => done(true);
        const onGone = () => done(false);
        function done(ok: boolean) {
          clearTimeout(timer);
          res.off("drain", onDrain);
          res.off("close", onGone);
          resolve(ok);
        }
        res.once("drain", onDrain);
        res.once("close", onGone);
      });
      if (!drained) {
        res.destroy();
        return "cut";
      }
    }
    res.end();
    return "sent";
  } finally {
    res.off("close", onClose);
  }
}

export function createFileDownloadRouter(opts: {
  db: Database;
  baseUrl: string;
  /** Called once a file has started on its way, for the usage event. */
  onSent?: (event: { userId: string; bytes: number; complete: boolean }) => void;
  depsFor?: (userId: string) => DownloadDeps;
  sendLimits?: Parameters<typeof sendBytes>[2];
}): Router {
  const router = Router();
  const connectionsUrl = `${opts.baseUrl}/dashboard/connections`;
  const depsFor =
    opts.depsFor ?? ((userId: string) => downloadDepsFor(opts.db, userId, "mcp", connectionsUrl));

  const log = (method: string, outcome: string, bytes = 0) =>
    console.log(`[file-download] method=${method} outcome=${outcome} bytes=${bytes}`);

  // THE ROUTER OWNS ALL OF `/files`, and reads the token from the raw path.
  // Two things depend on that. A path parameter is percent-decoded by the
  // framework before any handler runs, and a malformed escape after a live
  // token made its default error handler print the path, token included.
  // And a path this router did not match would fall through to the app,
  // whose pages report the URL they were opened at. So nothing under the
  // prefix is decoded, nothing under it reaches the app, and anything that
  // is not exactly a token is the "not valid" answer.
  router.use(DOWNLOAD_PREFIX, async (req: Request, res: Response) => {
    // No rate limit here, on purpose: a limit per client address guards
    // against guessing, which a 128-bit nonce does not need, and it would
    // rest on trusting a client-address header.
    const token = /^\/d\/([A-Za-z0-9_.-]{1,128})$/.exec(req.path)?.[1] ?? "";

    if (req.method === "GET") {
      const status = inspectLink(token);
      log("GET", status.kind);
      if (status.kind !== "live") return sentence(res, status.kind);
      baseHeaders(res);
      res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'");
      res.status(200).type("text/html; charset=utf-8").send(downloadPage(status.name, status.bytes));
      return;
    }

    if (req.method !== "POST") {
      baseHeaders(res);
      res.status(405).set("Allow", "GET, POST").end();
      return;
    }

    let outcome: RedeemOutcome;
    try {
      outcome = await redeemDownloadLink(token, depsFor, async (file) => {
        baseHeaders(res);
        res.setHeader("Content-Disposition", contentDisposition(file.name));
        res.setHeader("Content-Type", file.type);
        res.setHeader("Content-Length", String(file.bytes.length));
        res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; frame-ancestors 'none'");
        res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
        res.setHeader("Accept-Ranges", "none");
        res.status(200);
        const sent = await sendBytes(res, file.bytes, opts.sendLimits);
        log("POST", sent === "sent" ? "sent" : "cut", file.bytes.length);
        opts.onSent?.({ userId: file.userId, bytes: file.bytes.length, complete: sent === "sent" });
      });
    } catch {
      // Nothing from the failure is echoed or logged: it could describe the
      // file or carry the path.
      log("POST", "error");
      if (!res.headersSent) sentence(res, "source");
      else res.destroy();
      return;
    }
    if (outcome.kind === "send") return;
    log("POST", outcome.kind);
    if (!res.headersSent) sentence(res, outcome.kind);
    // The send died after it began: there is nothing to say on a response
    // already under way, and leaving it open would hang the socket.
    else res.destroy();
  });

  // A PATH THAT IS THIS PREFIX IN DISGUISE STOPS HERE TOO. `/files%2Fd%2F..`,
  // `//files/d/..`, `/%66iles/d/..` and their kin do not match the mount
  // above, so they would go on to the app with a live token in them, and a
  // malformed escape there makes the framework print the path. Read raw,
  // never through a decoded parameter.
  router.use((req: Request, res: Response, next) => {
    if (!looksLikeDownloadPath(req.url)) return next();
    log(req.method, "invalid");
    sentence(res, "invalid");
  });

  return router;
}

/** Whether a raw request target is the download prefix under some spelling:
 * percent-escapes decoded one at a time (twice, for a doubled escape),
 * backslashes as slashes, repeated slashes and `.` segments collapsed, case
 * ignored. The query string is not part of it. */
export function looksLikeDownloadPath(rawUrl: string): boolean {
  const path = percentUnescape(percentUnescape(rawUrl.split(/[?#]/, 1)[0]))
    .replace(/\\/g, "/")
    .replace(/\/(\.\/)+/g, "/")
    .replace(/\/{2,}/g, "/")
    .toLowerCase();
  return path === DOWNLOAD_PREFIX || path.startsWith(`${DOWNLOAD_PREFIX}/`);
}

/**
 * For the app, mounted last: a request target that cannot be percent-decoded
 * is answered 400 and named by the kind of error alone. The framework's own
 * handler prints the message, and the message quotes the path, which is
 * where a download link's token is.
 */
export function quietDecodeErrors(
  err: unknown,
  _req: Request,
  res: Response,
  next: (err?: unknown) => void
): void {
  if (!(err instanceof URIError)) return next(err);
  console.error("[http] a request target could not be decoded");
  if (res.headersSent) return void res.destroy();
  res.status(400).type("text/plain; charset=utf-8").send("Bad request.");
}
