/**
 * `ctx.http` refuses everything that is not a loopback path (SCRUM-303).
 *
 * Each case here is a real way a URL escapes a naive "starts with a slash"
 * check, which is what this helper exists instead of.
 */

import { describe, expect, it, vi } from "vitest";
import { buildLoopbackUrl, createHttpFetcher, loopbackBase } from "./http";

const BASE = loopbackBase(8285);

describe("what it accepts", () => {
  it.each([
    ["/health", "http://127.0.0.1:8285/health"],
    ["/.well-known/oauth-protected-resource", "http://127.0.0.1:8285/.well-known/oauth-protected-resource"],
    ["/mcp?probe=1", "http://127.0.0.1:8285/mcp?probe=1"],
    ["/", "http://127.0.0.1:8285/"],
  ])("%s", (path, expected) => {
    expect(buildLoopbackUrl(BASE, path).toString()).toBe(expected);
  });
});

describe("what it refuses", () => {
  it.each([
    ["a full URL somewhere else", "http://evil.example/steal"],
    ["a full URL that looks local", "http://127.0.0.1:8285/health"],
    ["a protocol-relative URL, which keeps the scheme and changes the host", "//evil.example/steal"],
    ["a backslash instead of a slash", "\\evil.example"],
    ["a mixed slash and backslash", "/\\evil.example"],
    ["a scheme-relative path with credentials", "//user@evil.example/"],
    ["an empty path", ""],
    ["a relative path with no leading slash", "health"],
  ])("%s", (_label, path) => {
    expect(() => buildLoopbackUrl(BASE, path)).toThrow();
  });

  it("a control character, which can truncate a URL in a log or a proxy", () => {
    expect(() => buildLoopbackUrl(BASE, "/health" + String.fromCharCode(10) + "X")).toThrow(/control character/);
    expect(() => buildLoopbackUrl(BASE, "/health" + String.fromCharCode(0))).toThrow(/control character/);
  });

  it("an @ AFTER a single leading slash is just a path, and stays local", () => {
    // Worth pinning rather than refusing: `@` is a userinfo separator only
    // before the host, so `/@x` cannot move the origin. Refusing it would be
    // superstition, and superstition in a guard teaches the next reader the
    // wrong rule.
    expect(buildLoopbackUrl(BASE, "/@evil.example/").origin).toBe("http://127.0.0.1:8285");
  });

  it("names the origin it refused, so a failing case says why", () => {
    expect(() => buildLoopbackUrl(BASE, "//evil.example")).toThrow(/single/);
  });
});

describe("the fetcher", () => {
  it("passes the built URL through and never follows a redirect", async () => {
    const fake = vi.fn().mockResolvedValue(new Response("ok"));
    const http = createHttpFetcher(BASE, fake as unknown as typeof fetch);
    await http("/health", { headers: { accept: "application/json" } });

    const [url, init] = fake.mock.calls[0];
    expect(String(url)).toBe("http://127.0.0.1:8285/health");
    expect((init as RequestInit).redirect).toBe("manual");
    expect((init as RequestInit).headers).toEqual({ accept: "application/json" });
  });

  it("refuses before it reaches the network at all", async () => {
    // The check has to happen BEFORE the request, not after: a helper that
    // fetches and then complains has already made the call.
    const fake = vi.fn();
    const http = createHttpFetcher(BASE, fake as unknown as typeof fetch);
    await expect(http("http://evil.example/")).rejects.toThrow();
    expect(fake).not.toHaveBeenCalled();
  });

  it("cannot have its redirect mode overridden by a case", async () => {
    const fake = vi.fn().mockResolvedValue(new Response("ok"));
    const http = createHttpFetcher(BASE, fake as unknown as typeof fetch);
    await http("/health", { redirect: "follow" });
    expect((fake.mock.calls[0][1] as RequestInit).redirect).toBe("manual");
  });
});
