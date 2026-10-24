/**
 * SCRUM-437: the HTTP side of an upload link. `/files/u/<token>[/<name>]`.
 *
 * THE LINK IS THE CREDENTIAL, as for a download link: no sign-in and no
 * cookie. It takes one file, within ten minutes of being made, for the user
 * who asked for it; what arrives is held in memory for that user's next
 * call and is never written to disk.
 *
 * A PUT carries the file as its body, which is what `curl -T` sends; the
 * trailing slash of the command makes curl append the file's own name to
 * the path. A GET says what the link is and spends nothing.
 *
 * The file arrives inside an upload slot, from its own pool, so a slow
 * phone cannot hold a slot the Jira and Drive crossings need. It is read
 * under the link's cap, and cut when it stops arriving or takes too long.
 *
 * NOTHING ABOUT THE FILE OR THE LINK IS LOGGED: one line per request with
 * the method, the outcome and a byte count. The token is in the path, so
 * this route never prints `req.url`.
 */

import type { Request, Response } from "express";
import { beginReceive, inspectUploadLink, type DeadUpload } from "./file-download";
import { withSlot, type RefusalWords } from "./file-crossing";
import { cleanInboundName, typeForName } from "./file-inbound";

/** Most to take the whole file, start to end. */
export const RECEIVE_DEADLINE_MS = 120_000;
/** A sender that sends nothing for this long is cut. */
export const RECEIVE_STALL_MS = 15_000;

const RECEIVE_WORDS: RefusalWords = {
  clause: "nothing was uploaded",
  sentence: "Nothing was uploaded.",
  busy: "Nothing was uploaded",
};

const NEW_ONE = "Ask for a new one in your conversation.";

const SENTENCES: Record<DeadUpload | "full", { status: number; text: string }> = {
  used: { status: 410, text: `This upload link has already been used. A link takes one file. ${NEW_ONE}` },
  receiving: { status: 409, text: "A file is already arriving on this link." },
  expired: { status: 410, text: `This upload link has expired. A link lasts ten minutes. ${NEW_ONE}` },
  cancelled: { status: 410, text: `This upload link was cancelled because it was passed to another tool. ${NEW_ONE}` },
  invalid: { status: 404, text: `This upload link is not valid. ${NEW_ONE}` },
  full: {
    status: 503,
    text: "The service is holding as many uploaded files as it can right now. Nothing was uploaded; try again in a few minutes.",
  },
};

function baseHeaders(res: Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Robots-Tag", "noindex, nofollow");
  res.setHeader("Referrer-Policy", "no-referrer");
}

function say(res: Response, status: number, text: string, close = false): void {
  baseHeaders(res);
  if (status === 503) res.setHeader("Retry-After", "60");
  // A refusal while the body is still arriving: the rest is not read, so the
  // connection is not reused.
  if (close) res.setHeader("Connection", "close");
  res.status(status).type("text/plain; charset=utf-8").send(text);
}

const log = (method: string, outcome: string, bytes = 0) =>
  console.log(`[file-upload] method=${method} outcome=${outcome} bytes=${bytes}`);

/** One percent-decoding, or nothing when the text is not valid encoding. */
function decoded(text: string | undefined): string {
  if (!text) return "";
  try {
    return decodeURIComponent(text);
  } catch {
    return "";
  }
}

const header = (req: Request, name: string): string | undefined => {
  const value = req.headers[name];
  return typeof value === "string" && value ? value : undefined;
};

type Received =
  | { kind: "ok"; bytes: Buffer<ArrayBuffer> }
  | { kind: "over" | "stalled" | "late" | "aborted" };

/** Reads the request body, never more than `cap` bytes, cutting a sender
 * that stalls or takes too long. */
function receive(req: Request, cap: number, limits: { deadlineMs: number; stallMs: number }): Promise<Received> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let done = false;
    let stall: ReturnType<typeof setTimeout>;
    const finish = (outcome: Received) => {
      if (done) return;
      done = true;
      clearTimeout(stall);
      clearTimeout(deadline);
      req.off("data", onData);
      req.off("end", onEnd);
      req.off("aborted", onAborted);
      req.off("error", onAborted);
      if (outcome.kind !== "ok") req.pause();
      resolve(outcome);
    };
    const armStall = () => {
      clearTimeout(stall);
      stall = setTimeout(() => finish({ kind: "stalled" }), limits.stallMs);
    };
    const deadline = setTimeout(() => finish({ kind: "late" }), limits.deadlineMs);
    const onData = (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) return finish({ kind: "over" });
      chunks.push(chunk);
      armStall();
    };
    const onEnd = () => finish({ kind: "ok", bytes: Buffer.concat(chunks, total) as Buffer<ArrayBuffer> });
    const onAborted = () => finish({ kind: "aborted" });
    req.on("data", onData);
    req.on("end", onEnd);
    req.on("aborted", onAborted);
    req.on("error", onAborted);
    armStall();
  });
}

/**
 * One request under `/files/u/`. `path` is the part after `/files`, raw:
 * `/u/<token>` or `/u/<token>/<name>`.
 */
export async function handleUploadRequest(
  req: Request,
  res: Response,
  path: string,
  limits: { deadlineMs?: number; stallMs?: number } = {}
): Promise<void> {
  const m = /^\/u\/([A-Za-z0-9_.-]{1,128})(?:\/([^/]*))?$/.exec(path);
  const token = m?.[1] ?? "";
  const pathName = m?.[2];

  if (req.method === "GET") {
    const status = inspectUploadLink(token);
    log("GET", status.kind);
    if (status.kind !== "live") return say(res, SENTENCES[status.kind].status, SENTENCES[status.kind].text);
    baseHeaders(res);
    res
      .status(200)
      .type("text/plain; charset=utf-8")
      .send("This link takes one file, sent with the command your assistant gave you. It works once, within ten minutes.");
    return;
  }

  if (req.method !== "PUT") {
    log(req.method, "method");
    baseHeaders(res);
    res.status(405).set("Allow", "GET, PUT").end();
    return;
  }

  const begun = beginReceive(token);
  if (!begun.ok) {
    log("PUT", begun.kind);
    return say(res, SENTENCES[begun.kind].status, SENTENCES[begun.kind].text, true);
  }
  // The link is claimed from here: whatever happens below, it is either
  // holding the file or given back, never left claimed. A claim left behind
  // would keep its room reserved against the host's ceiling for good.
  try {
    const mb = `${Math.round((begun.maxBytes / (1024 * 1024)) * 10) / 10} MB`;
    const tooLarge = `The file is larger than ${mb}, the most this link takes. Nothing was uploaded.`;

    // Content-Length is only a shortcut for an honest sender; the read below
    // holds the cap whatever it says.
    const declared = Number(header(req, "content-length"));
    if (Number.isFinite(declared) && declared > begun.maxBytes) {
      begun.finish(null);
      log("PUT", "too_large");
      return say(res, 413, tooLarge, true);
    }

    const slot = await withSlot(begun.userId, "upload", RECEIVE_WORDS, () =>
      receive(req, begun.maxBytes, {
        deadlineMs: limits.deadlineMs ?? RECEIVE_DEADLINE_MS,
        stallMs: limits.stallMs ?? RECEIVE_STALL_MS,
      })
    );
    if (!slot.ok) {
      begun.finish(null);
      log("PUT", "busy");
      return say(res, 503, slot.result.content.map((c) => c.text ?? "").join(" "), true);
    }
    const got = slot.value;
    if (got.kind !== "ok") {
      begun.finish(null);
      log("PUT", got.kind);
      if (got.kind === "over") return say(res, 413, tooLarge, true);
      if (got.kind === "aborted") return void res.destroy();
      return say(res, 408, "The file stopped arriving, so nothing was uploaded. The link still works; try again.", true);
    }
    if (got.bytes.byteLength === 0) {
      begun.finish(null);
      log("PUT", "empty");
      return say(res, 400, "The upload is empty. Nothing was uploaded.");
    }

    // The name: what the page declares, else what curl appended, else the
    // link's hint. The type: declared, unless it is a generic one a client
    // sends by habit, else from the name.
    const name = cleanInboundName(decoded(header(req, "x-file-name")) || decoded(pathName) || begun.nameHint || "", "upload");
    const contentType = header(req, "content-type");
    const declaredType =
      header(req, "x-file-type") ??
      (contentType && !/^application\/(?:octet-stream|x-www-form-urlencoded)\b/i.test(contentType) ? contentType : undefined);
    const receipt = begun.finish({ bytes: got.bytes, name, type: typeForName(name, declaredType) });
    if (!receipt) {
      log("PUT", "cancelled");
      return say(res, SENTENCES.cancelled.status, SENTENCES.cancelled.text);
    }
    log("PUT", "received", got.bytes.byteLength);
    baseHeaders(res);
    res.status(200).type("application/json").send(`${JSON.stringify(receipt, null, 2)}\n`);

  } catch {
    begun.finish(null);
    log("PUT", "error");
    if (!res.headersSent) say(res, 500, "The upload could not be taken. Nothing was uploaded; try again.", true);
    else res.destroy();
  }
}
