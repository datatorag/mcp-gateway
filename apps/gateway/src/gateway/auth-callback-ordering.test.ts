import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The connect callback consumes three ONE-SHOT cookies at the top — the CSRF
 * nonce clear, `takeAttribution` (SCRUM-87), `takeConnectNext` (SCRUM-78) —
 * and each is correct only because it runs BEFORE any response is issued, on
 * every path including the rejections. Three separate features added those in
 * one evening; the fourth early return is coming, and if it lands above one of
 * the consumers, nothing fails: a cookie just survives into the next flow and
 * mis-attributes or mis-routes a later user, days later, with no trace.
 *
 * A behavioural test cannot catch that — it can only exercise branches that
 * already exist, and the hazard is a branch that does not exist yet. So this
 * pins the INVARIANT by source order: every consumer must appear before the
 * first response in the handler body. An early return added above them puts a
 * `res.redirect` ahead of a consumer and turns this red.
 *
 * Same shape as SCRUM-66's built-in registry: make the boundary structural, so
 * a future addition inherits the rule by construction rather than by memory.
 *
 * The classic textual-guard trap — a check satisfied by a comment that quotes
 * the call it is looking for — is closed two ways: comments are stripped before
 * anything is searched, and the self-check below feeds the assertion a body
 * with a response placed first and proves it goes red, so the guard cannot pass
 * by failing to look.
 */

const AUTH_SRC = readFileSync(
  fileURLToPath(new URL("./auth.ts", import.meta.url)),
  "utf8"
);

/** Strip line and block comments so a call quoted in prose cannot satisfy the
 * guard. Deliberately not a full JS parser — string literals in this handler
 * contain no `//` or `/* *\/`, so a lexer would be more machinery than the
 * input warrants; if that ever changes, this must become a real parse. */
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

/** The body of one route handler, by its path literal, comments removed. The
 * slice runs to the next `router.get(` — the connect callback is followed by
 * the Atlassian connect route, so that boundary captures exactly this one. */
function handlerBody(pathLiteral: string): string {
  const src = stripComments(AUTH_SRC);
  const start = src.indexOf(`router.get("${pathLiteral}"`);
  if (start === -1) throw new Error(`handler not found: ${pathLiteral}`);
  const rest = src.slice(start + pathLiteral.length);
  const nextRoute = rest.indexOf("router.get(");
  return nextRoute === -1 ? rest : rest.slice(0, nextRoute);
}

/** The one-shot consumers, by call shape (not bare name, so a mention in a
 * string or a renamed local cannot pass for the call). */
const CONSUMERS = [
  "res.clearCookie(GWS_CONNECT_NONCE_COOKIE",
  "takeAttribution(",
  "takeConnectNext(",
];

/** Anything that issues a response and can end the handler. The connect
 * callback only uses redirect today; the rest are here so that adding one
 * above the consumers later is caught the same way. */
const RESPONSE_CALLS = [
  "res.redirect(",
  "res.send(",
  "res.json(",
  "res.status(",
  "res.end(",
];

/** Index of the first response call in a body, or -1 if none. */
function firstResponseIndex(body: string): number {
  const hits = RESPONSE_CALLS.map((c) => body.indexOf(c)).filter((i) => i >= 0);
  return hits.length === 0 ? -1 : Math.min(...hits);
}

/** Assert every consumer runs before the first response. Returned rather than
 * asserted inline so the self-check can call it on a known-bad body. */
function consumersRunBeforeFirstResponse(body: string): {
  ok: boolean;
  offender?: string;
} {
  const firstResponse = firstResponseIndex(body);
  if (firstResponse === -1) return { ok: true }; // no response = nothing to beat
  for (const consumer of CONSUMERS) {
    const at = body.indexOf(consumer);
    if (at === -1 || at > firstResponse) return { ok: false, offender: consumer };
  }
  return { ok: true };
}

describe("connect callback: one-shot cookie consumers run before any response", () => {
  it("every consumer precedes the first response in the live handler", () => {
    const body = handlerBody("/auth/google/connect/callback");
    // Guard against a silent extraction failure: if the slice missed the body,
    // the consumers would be 'absent' and the test could pass vacuously.
    for (const consumer of CONSUMERS) {
      expect(body, `handler body should contain ${consumer}`).toContain(consumer);
    }
    expect(firstResponseIndex(body), "handler should issue a response").toBeGreaterThan(-1);

    const result = consumersRunBeforeFirstResponse(body);
    expect(
      result.ok,
      `${result.offender ?? "a consumer"} must run before the first response — ` +
        "a new early return was added above the one-shot cookie block"
    ).toBe(true);
  });

  it("goes red when a response is placed before a consumer (self-check)", () => {
    // A body shaped like a future mistake: an early return added ABOVE the
    // consumers. The guard must reject it, or it is not looking.
    const bad = [
      `if (req.query.evil) { res.redirect("/x"); return; }`,
      `res.clearCookie(GWS_CONNECT_NONCE_COOKIE, { path: "/" });`,
      `const a = takeAttribution(req, res);`,
      `const p = takeConnectNext(req, res);`,
      `res.redirect("/ok");`,
    ].join("\n");
    expect(consumersRunBeforeFirstResponse(bad).ok).toBe(false);

    // And the good ordering passes, so the guard is not merely rejecting
    // everything — pin the boundary in both directions.
    const good = [
      `res.clearCookie(GWS_CONNECT_NONCE_COOKIE, { path: "/" });`,
      `const a = takeAttribution(req, res);`,
      `const p = takeConnectNext(req, res);`,
      `if (req.query.evil) { res.redirect("/x"); return; }`,
      `res.redirect("/ok");`,
    ].join("\n");
    expect(consumersRunBeforeFirstResponse(good).ok).toBe(true);
  });

  it("strips comments, so a consumer quoted in a comment cannot satisfy the guard", () => {
    // The exact bypass this defends against: the call name appears in a
    // comment ABOVE the response, but the real call is missing. With comments
    // stripped, the consumer is genuinely absent and the guard fails.
    const commentedBad = stripComments(
      [
        `// this handler calls takeAttribution( and takeConnectNext( up top`,
        `res.clearCookie(GWS_CONNECT_NONCE_COOKIE, { path: "/" });`,
        `res.redirect("/ok");`,
      ].join("\n")
    );
    expect(consumersRunBeforeFirstResponse(commentedBad).ok).toBe(false);
  });
});
