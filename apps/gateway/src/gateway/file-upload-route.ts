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

import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { beginReceive, inspectUploadLink, type DeadUpload } from "./file-download";
import { withSlot, type RefusalWords } from "./file-crossing";
import { cleanInboundName, typeForName } from "./file-inbound";
import { FRAME_CSP } from "./security-headers";

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

const ENTITIES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => ENTITIES[c]);

const sizeWords = (bytes: number) =>
  bytes < 1024 * 1024 ? `${Math.ceil(bytes / 1024)} KB` : `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;

/** The page's policy: its one script by a nonce made for this response, a
 * PUT back to this service, and nothing framed, posted or loaded from
 * anywhere else. It replaces the framing-only CSP every response carries,
 * so it says `frame-ancestors 'none'` itself. */
export function uploadPageCsp(nonce: string): string {
  // The framing part is the one every response carries, so a change there
  // reaches this page too.
  return `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'none'; base-uri 'none'; ${FRAME_CSP}`;
}

/**
 * The drop page (SCRUM-437): a file picker that is also a drop zone, one
 * Upload button, the name and size before sending, a progress bar, and the
 * receipt with the reference to paste back. The one script sends the file
 * with an XMLHttpRequest PUT, for the upload progress fetch does not report,
 * and writes only text. Without scripts the page names the curl line. The
 * title is fixed text, so a previewer that copies titles copies nothing
 * about the link; styled as the download page is.
 */
export function uploadPage(opts: { nameHint: string | null; maxBytes: number; scriptNonce: string; curlUrl: string }): string {
  const hint = opts.nameHint ? `<p class="hint">For <strong>${escapeHtml(opts.nameHint)}</strong></p>` : "";
  const curl = escapeHtml(`curl -fsS -T <path-to-file> "${opts.curlUrl}"`);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Upload file</title>
<style>
*{box-sizing:border-box}
body{font:16px/1.5 system-ui,sans-serif;margin:0;display:grid;min-height:100vh;place-items:center;background:#f6f7f9;color:#14171f}
main{width:100%;max-width:28rem;margin:1rem;padding:2rem;background:#fff;border:1px solid #dde1e8;border-radius:12px}
h1{font-size:1.125rem;margin:0 0 .25rem}
p{margin:.25rem 0 1rem;color:#4a5263}
.hint{overflow-wrap:anywhere}
label.drop{display:block;padding:1.5rem 1rem;border:2px dashed #c3c9d4;border-radius:10px;text-align:center;cursor:pointer;color:#4a5263}
label.drop.over{border-color:#14171f;background:#f6f7f9}
input[type=file]{position:absolute;width:1px;height:1px;opacity:0}
#chosen{margin:.75rem 0 0;color:#14171f;overflow-wrap:anywhere;min-height:1.5em}
button{font:inherit;font-weight:600;padding:.625rem 1.25rem;border:0;border-radius:8px;background:#14171f;color:#fff;cursor:pointer}
button:disabled{opacity:.4;cursor:default}
.row{display:flex;gap:.5rem;align-items:center;margin-top:1rem;flex-wrap:wrap}
progress{width:100%;height:.5rem;margin-top:1rem}
#status{margin-top:.75rem;color:#14171f;overflow-wrap:anywhere}
#receipt{overflow-wrap:anywhere;word-break:break-all;font-size:.875rem}
#status.error{color:#b42318}
pre{white-space:pre-wrap;overflow-wrap:anywhere;background:#f6f7f9;border:1px solid #dde1e8;border-radius:8px;padding:.75rem;font-size:.875rem;margin:.5rem 0}
small{display:block;margin-top:1.25rem;color:#4a5263}
[hidden]{display:none!important}
</style>
</head>
<body>
<main>
<h1>Send a file to DataToRAG</h1>
${hint}<p>One file, at most ${escapeHtml(sizeWords(opts.maxBytes))}. It is not placed in your conversation.</p>
<noscript><p>This page needs JavaScript. Without it, send the file from a terminal:</p><pre>${curl}</pre></noscript>
<label class="drop" id="drop" for="file">Choose a file, or drop it here<input type="file" id="file"></label>
<p id="chosen"></p>
<div class="row"><button type="button" id="send" disabled>Upload</button></div>
<progress id="progress" max="100" value="0" hidden></progress>
<p id="status" role="status"></p>
<div id="done" hidden>
<p>Paste this into your conversation, so the file can be used:</p>
<pre id="reference"></pre>
<div class="row"><button type="button" id="copy">Copy</button></div>
<p id="receipt"></p>
</div>
<small>This link takes one file and stops working ten minutes after it was made. The file is kept for ten minutes after it arrives, for one use, and never written to disk.</small>
</main>
<script nonce="${opts.scriptNonce}">
(function () {
  var input = document.getElementById("file");
  var drop = document.getElementById("drop");
  var chosen = document.getElementById("chosen");
  var send = document.getElementById("send");
  var progress = document.getElementById("progress");
  var status = document.getElementById("status");
  var done = document.getElementById("done");
  var reference = document.getElementById("reference");
  var receipt = document.getElementById("receipt");
  var copy = document.getElementById("copy");
  var file = null;
  function size(n) { return n < 1048576 ? Math.ceil(n / 1024) + " KB" : (Math.round(n / 104857.6) / 10) + " MB"; }
  function pick(f) {
    file = f || null;
    chosen.textContent = file ? file.name + " (" + size(file.size) + ")" : "";
    send.disabled = !file;
    status.textContent = "";
    status.className = "";
  }
  input.addEventListener("change", function () { pick(input.files && input.files[0]); });
  drop.addEventListener("dragover", function (e) { e.preventDefault(); drop.className = "drop over"; });
  drop.addEventListener("dragleave", function () { drop.className = "drop"; });
  drop.addEventListener("drop", function (e) {
    e.preventDefault();
    drop.className = "drop";
    if (e.dataTransfer && e.dataTransfer.files.length) pick(e.dataTransfer.files[0]);
  });
  send.addEventListener("click", function () {
    if (!file) return;
    send.disabled = true;
    input.disabled = true;
    progress.hidden = false;
    progress.value = 0;
    status.className = "";
    status.textContent = "Uploading\u2026";
    var xhr = new XMLHttpRequest();
    xhr.open("PUT", location.pathname);
    xhr.setRequestHeader("X-File-Name", encodeURIComponent(file.name));
    if (file.type) xhr.setRequestHeader("X-File-Type", file.type);
    xhr.upload.onprogress = function (e) { if (e.lengthComputable) progress.value = Math.round((e.loaded / e.total) * 100); };
    xhr.onload = function () {
      if (xhr.status === 200) {
        var answer = JSON.parse(xhr.responseText);
        progress.value = 100;
        status.textContent = "Uploaded.";
        reference.textContent = JSON.stringify(answer.reference);
        receipt.textContent = answer.received.name + ", " + size(answer.received.bytes) + ", SHA-256 " + answer.received.sha256;
        done.hidden = false;
        return;
      }
      progress.hidden = true;
      status.className = "error";
      status.textContent = xhr.responseText || "The upload did not go through.";
      if (xhr.status === 413 || xhr.status === 408 || xhr.status === 503 || xhr.status === 500 || xhr.status === 400) {
        send.disabled = false;
        input.disabled = false;
      }
    };
    xhr.onerror = function () {
      progress.hidden = true;
      status.className = "error";
      status.textContent = "The upload did not go through. Check your connection and try again.";
      send.disabled = false;
      input.disabled = false;
    };
    xhr.send(file);
  });
  copy.addEventListener("click", function () {
    var text = reference.textContent || "";
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(function () { copy.textContent = "Copied"; });
  });
})();
</script>
</body>
</html>
`;
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
  limits: { deadlineMs?: number; stallMs?: number } = {},
  /** Absolute origin of this gateway, for the page's curl line. */
  baseUrl = ""
): Promise<void> {
  const m = /^\/u\/([A-Za-z0-9_.-]{1,128})(?:\/([^/]*))?$/.exec(path);
  const token = m?.[1] ?? "";
  const pathName = m?.[2];

  if (req.method === "GET") {
    const status = inspectUploadLink(token);
    log("GET", status.kind);
    if (status.kind !== "live") return say(res, SENTENCES[status.kind].status, SENTENCES[status.kind].text);
    const nonce = randomBytes(18).toString("base64url");
    baseHeaders(res);
    res.setHeader("Content-Security-Policy", uploadPageCsp(nonce));
    res
      .status(200)
      .type("text/html; charset=utf-8")
      .send(
        uploadPage({
          nameHint: status.nameHint,
          maxBytes: status.maxBytes,
          scriptNonce: nonce,
          curlUrl: `${baseUrl.replace(/\/+$/, "")}/files/u/${token}/`,
        })
      );
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
