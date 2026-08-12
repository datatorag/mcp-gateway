/**
 * Anti-framing headers: that they are correct, and that they are WIRED.
 *
 * Two different failures, so two different kinds of test. A unit test of the
 * middleware alone would stay green if someone deleted the `app.use` line in
 * `server.ts`, which is precisely the mutation that turns the protection off
 * — a guard nobody would miss is a guard that can be silently removed. So the
 * wiring gets asserted too, and it is asserted for ORDER as well as presence,
 * because a middleware mounted after a router that already responded protects
 * nothing on that route.
 *
 * Real Express here, not a mock `res`. A hand-rolled fake would let me assert
 * `setHeader` was CALLED, which is a claim about my own test double rather
 * than about what a browser receives.
 */

import { createServer, type Server } from "node:http";
import express from "express";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FRAME_CSP, FRAME_OPTIONS, securityHeaders } from "./security-headers";

describe("the middleware, over real HTTP", () => {
  let server: Server;
  let base: string;

  beforeAll(async () => {
    const app = express();
    app.use(securityHeaders);
    app.get("/page", (_req, res) => res.send("<html>hi</html>"));
    app.post("/api", (_req, res) => res.status(201).json({ ok: true }));
    app.get("/boom", (_req, res) => res.status(500).send("no"));
    server = createServer(app);
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const addr = server.address();
    if (typeof addr === "string" || addr === null) throw new Error("no port");
    base = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => server.close(() => r()));
  });

  it("refuses framing on an ordinary page", async () => {
    const res = await fetch(`${base}/page`);
    expect(res.headers.get("content-security-policy")).toBe(FRAME_CSP);
    expect(res.headers.get("x-frame-options")).toBe(FRAME_OPTIONS);
  });

  it("sends both headers on non-GET and on error responses too", async () => {
    // An attacker picks the response, not us. A header that only rides along
    // with 200s on GET leaves whatever else is reachable framable.
    for (const [path, init] of [
      ["/api", { method: "POST" }],
      ["/boom", undefined],
    ] as const) {
      const res = await fetch(`${base}${path}`, init);
      expect(res.headers.get("content-security-policy"), path).toBe(FRAME_CSP);
      expect(res.headers.get("x-frame-options"), path).toBe(FRAME_OPTIONS);
    }
  });

  it("denies rather than merely restricting to same origin", async () => {
    // `SAMEORIGIN`/`'self'` would let our own pages frame each other, which
    // buys nothing here and leaves a path open to any future HTML injection.
    const res = await fetch(`${base}/page`);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("'none'");
  });

  it("restricts framing and NOTHING else", async () => {
    // Scope discipline: a CSP that quietly grew a script-src would be a much
    // riskier change wearing this ticket's clothes.
    const csp = (await fetch(`${base}/page`)).headers.get("content-security-policy")!;
    expect(csp.split(";").filter((d) => d.trim() !== "")).toHaveLength(1);
    expect(csp).toContain("frame-ancestors");
  });
});

describe("it is actually wired into the server", () => {
  const source = readFileSync(join(import.meta.dirname, "../../server.ts"), "utf8");
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("mounts the middleware UNCONDITIONALLY", () => {
    // If this fails, the module below is dead code and every test above is
    // testing a function nothing calls.
    //
    // Anchored to a whole statement rather than matched as a substring. A
    // plain `toContain` stays green for `if (process.env.X) app.use(...)`,
    // which reads as mounted and is off in production — the one mutation the
    // first version of this test missed.
    expect(
      /^\s*app\.use\(securityHeaders\);\s*$/m.test(code),
      "server.ts must mount securityHeaders as an unconditional statement. It is either " +
        "missing or now guarded by a condition, and a conditional mount is off wherever " +
        "the condition is false."
    ).toBe(true);
  });

  it("mounts it BEFORE anything that can respond", () => {
    const mount = code.indexOf("app.use(securityHeaders)");
    expect(mount, "securityHeaders is not mounted at all").toBeGreaterThan(-1);
    // The first handler registration of any kind that is not ours. Every verb
    // Express exposes, not just the four this app happens to use today: a
    // future first responder registered as `app.put(...)` would otherwise be
    // invisible here and the check would pass while that route answered
    // without the headers.
    const first = [...code.matchAll(
      /app\.(use|get|post|put|patch|delete|options|head|all|route)\(/g
    )]
      .map((m) => m.index!)
      .filter((i) => i !== mount)
      .sort((a, b) => a - b)[0];
    expect(first, "no other handlers found — this check would be vacuous").toBeGreaterThan(-1);
    expect(
      mount,
      "securityHeaders must be mounted first; a route registered earlier can respond without the headers"
    ).toBeLessThan(first);
  });
});

describe("a future CSP elsewhere cannot silently drop frame protection", () => {
  it("next.config does not set a CSP that omits frame-ancestors", () => {
    // The realistic way this protection disappears: someone adds a
    // Content-Security-Policy in next.config for scripts. Next sets it on the
    // response AFTER Express set ours, `setHeader` replaces rather than
    // merges, and frame-ancestors vanishes with no error anywhere. X-Frame-
    // Options survives that (different header), which is half the reason it
    // is still sent — but the CSP should not regress silently either.
    const cfg = readFileSync(join(import.meta.dirname, "../../next.config.ts"), "utf8");
    const setsCsp = /["'`]?Content-Security-Policy["'`]?\s*[:,]/i.test(cfg);
    if (!setsCsp) {
      expect(setsCsp).toBe(false); // nothing to conflict with today
      return;
    }
    expect(
      cfg,
      "next.config now sets a Content-Security-Policy. It replaces the one Express " +
        "sets, so it MUST carry frame-ancestors 'none' or framing protection is lost."
    ).toContain("frame-ancestors");
  });
});
