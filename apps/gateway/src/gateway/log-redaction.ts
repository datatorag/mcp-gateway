/**
 * SCRUM-420: a download link's token never reaches the process's output.
 *
 * A download link is a credential in a URL path, and things we do not own
 * print paths: the framework's error handler, its image optimizer, anything
 * added later. Each one found was closed at its door, and each door had
 * another spelling. So the rule is kept where every one of them ends up:
 * whatever is written to stdout or stderr has anything shaped like a link
 * token replaced with a fixed word first. It does not look at requests at
 * all, so it does not depend on how a request was spelled.
 *
 * TWO RULES, because a shape alone can be broken by its neighbours. A token
 * printed with a letter touching it, or with its dot percent-encoded, no
 * longer has the shape. So every LIVE link's two halves are also redacted
 * by value, wherever they appear and whatever touches them; the link store
 * registers them when a link is made and forgets them when its record is
 * dropped. The shape rule stays for a token that is no longer in the store.
 *
 * What neither rule catches: a token its holder has deliberately rewritten
 * (reversed, re-encoded) before sending it somewhere that prints it.
 *
 * WHAT IT DOES NOT COVER, and does not need to: a response body. A route
 * that echoes the request back (a redirect's Location, an error page) shows
 * the token to whoever sent it, who already holds it. That is not a leak.
 * Nor a child process's own output; no plugin is ever given a link.
 *
 * A token split across two writes would pass. Loggers write a line at a
 * time, and the token has no line break in it.
 */

/** What a token is replaced with. */
export const REDACTED = "[download-link]";

/**
 * Exactly the shape `file-download.ts` mints: 22 URL-safe characters, a
 * dot, 43 more, and nothing of that alphabet on either side. The exact
 * lengths are what leave ordinary base64, hashes and ids alone. On the left
 * a percent-escape also counts as a boundary, because a path printed
 * encoded reads `%2F<token>` and the `F` is a letter.
 */
const LINK_TOKEN =
  /(?:(?<![A-Za-z0-9_-])|(?<=%[0-9A-Fa-f]{2}))[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/g;

/** The halves of every live link, by value. Per process, not per module
 * instance, for the reason the link store is: two bundles load this file
 * and one of them mints. */
const VALUES = Symbol.for("datatorag.log-redaction.values");
const values: Set<string> = ((globalThis as Record<symbol, unknown>)[VALUES] as Set<string> | undefined) ??
  ((globalThis as Record<symbol, unknown>)[VALUES] = new Set<string>());

/** From now on `value` is never written to the process's output. Short
 * values are refused: a few characters would blank ordinary words. */
export function redactValue(value: string): void {
  if (value.length >= 16) values.add(value);
}

export function forgetValue(value: string): void {
  values.delete(value);
}

export function redactLinkTokens(text: string): string {
  let out = text.replace(LINK_TOKEN, REDACTED);
  for (const value of values) {
    if (out.includes(value)) out = out.split(value).join(REDACTED);
  }
  return out;
}

type Sink = { write: (...args: never[]) => boolean };
const WRAPPED = Symbol.for("datatorag.log-redaction.wrapped");

/** Wraps one stream's `write`. On the stream object itself, so a logger
 * built before this ran is covered too: a console looks `write` up on its
 * stream at every call. Wrapping twice does nothing. */
export function redactSink(stream: Sink): void {
  const marked = stream as Sink & { [WRAPPED]?: true };
  if (marked[WRAPPED]) return;
  const write = stream.write.bind(stream) as (chunk: unknown, ...rest: unknown[]) => boolean;
  stream.write = ((chunk: unknown, ...rest: unknown[]) => {
    if (typeof chunk === "string") return write(redactLinkTokens(chunk), ...rest);
    if (chunk instanceof Uint8Array) {
      const text = Buffer.from(chunk.buffer, chunk.byteOffset, chunk.byteLength).toString("utf8");
      const clean = redactLinkTokens(text);
      // The original bytes go through untouched unless something was found.
      return clean === text ? write(chunk, ...rest) : write(Buffer.from(clean, "utf8"), ...rest);
    }
    return write(chunk, ...rest);
  }) as Sink["write"];
  marked[WRAPPED] = true;
}

/**
 * Installs the rule on this process: both output streams, and the one
 * thing that is printed without going through them. With no listener for
 * it, an uncaught error is written by the runtime straight to the
 * descriptor and the process exits 1. So this listens: when it is the ONLY
 * listener it prints the error through the wrapped stream and exits 1, which
 * is what would have happened. When something else listens too (the
 * framework does, once it is prepared, and keeps serving), that listener
 * does its own logging through the wrapped streams and this one does
 * nothing, so installing the rule never turns a survivable error into an
 * exit.
 */
export function installLogRedaction(): void {
  redactSink(process.stdout as unknown as Sink);
  redactSink(process.stderr as unknown as Sink);
  const marked = process as NodeJS.Process & { [WRAPPED]?: true };
  if (marked[WRAPPED]) return;
  marked[WRAPPED] = true;
  process.on("uncaughtException", (err) => {
    if (process.listenerCount("uncaughtException") > 1) return;
    console.error(err);
    process.exit(1);
  });
}
