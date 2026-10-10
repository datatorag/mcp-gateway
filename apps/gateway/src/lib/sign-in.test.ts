import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { isAuthFlowHref, signInHref, SIGN_IN_PATH } from "./sign-in";

describe("signInHref", () => {
  it("is the Google sign-in route, with the return path encoded when there is one", () => {
    expect(signInHref()).toBe("/auth/google");
    expect(signInHref(null)).toBe("/auth/google");
    expect(signInHref("")).toBe("/auth/google");
    expect(signInHref("/dashboard/agent?skill=morning-brief")).toBe(
      "/auth/google?next=%2Fdashboard%2Fagent%3Fskill%3Dmorning-brief"
    );
    expect(SIGN_IN_PATH).toBe("/auth/google");
  });

  it("knows an auth-flow href from a page", () => {
    expect(isAuthFlowHref("/auth/google")).toBe(true);
    expect(isAuthFlowHref("/auth/google?next=%2Fpricing")).toBe(true);
    expect(isAuthFlowHref("/auth/login")).toBe(true);
    expect(isAuthFlowHref("/dashboard/agent")).toBe(false);
    expect(isAuthFlowHref("/authors")).toBe(false);
  });
});

/**
 * The rule SCRUM-408 set, held mechanically: a call to action starts sign-in
 * itself. The login page is where a sign-in that did not finish comes back
 * to, and where a lapsed session is bounced; nothing else points at it.
 *
 * This reads source, so it can only see a literal. That is the right reach:
 * the regression it exists for is somebody typing the old href into a new
 * button.
 */
describe("who may point at the login page", () => {
  const SRC = join(__dirname, "..");
  /** Each with the reason it is allowed. */
  const ALLOWED: Record<string, string> = {
    "proxy.ts": "the middleware bounces a signed-out dashboard request",
    "gateway/auth.ts": "a sign-in or connect that did not finish comes back here",
    "app/robots.ts": "a comment about indexing",
    "app/dashboard/billing/portal-client.ts": "a session that lapsed under the open billing page",
    "gateway/leads/confirmation.ts": "an email link, which no click listener can attribute",
    "lib/sign-in.ts": "says what the login page is for",
    "lib/sign-in.test.ts": "this file",
  };

  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
    });
  }
  const sources = files(SRC).map((path) => ({
    rel: relative(SRC, path),
    text: readFileSync(path, "utf8"),
  }));

  it("finds the tree it is about to judge", () => {
    expect(sources.length).toBeGreaterThan(200);
    expect(sources.some((f) => f.rel === "components/navbar.tsx")).toBe(true);
  });

  it("no call to action links to /auth/login", () => {
    const offenders = sources
      .filter((f) => f.text.includes("/auth/login"))
      .map((f) => f.rel)
      // A dashboard page redirecting a request with no valid session is the
      // same bounce the middleware makes, one layer in.
      .filter((rel) => !/^app\/dashboard\/.*page\.tsx$/.test(rel))
      .filter((rel) => !(rel in ALLOWED) && rel !== "app/auth/login/page.tsx");
    expect(offenders).toEqual([]);
  });

  it("the sign-in route is never the href of a next/link", () => {
    // A prefetch of it would start a sign-in on render.
    const offenders = sources
      .filter((f) => /<Link\b[^>]*href=(\{signIn\w*\([^>]*|"\/auth\/)/.test(f.text))
      .map((f) => f.rel);
    expect(offenders).toEqual([]);
  });
});
