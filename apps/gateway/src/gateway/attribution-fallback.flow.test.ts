/**
 * SCRUM-88, end to end: a sign-in that never fired the click decorator (a
 * middle click, a new tab) still reaches the signup with where the visitor
 * came from. Driven through the REAL auth router over real HTTP, with the
 * real attribution module, so the stash at /auth/google, the cookie through
 * the consent round trip and the take at the callback are all the product's.
 * Only the write to the users row is observed instead of made.
 */

import { createServer, type Server } from "node:http";
import express from "express";
import cookieParser from "cookie-parser";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { users } from "@datatorag-mcp/db";

vi.mock("./track", () => ({
  trackLogin: vi.fn(),
  trackSignup: vi.fn(),
  trackOAuthCompleted: vi.fn(async () => undefined),
}));
vi.mock("./lifecycle", () => ({ sendWelcomeEmail: vi.fn(async () => undefined) }));
vi.mock("./signup-alert", () => ({ notifySignup: vi.fn(async () => undefined) }));
vi.mock("./attribution", async (orig) => ({
  ...(await orig<typeof import("./attribution")>()),
  persistAcquisition: vi.fn(async () => undefined),
}));

import { createAuthRouter } from "./auth";
import { captureEntry, persistAcquisition } from "./attribution";

const NEW_USER = { id: "user-new", email: "new@example.com", name: "New", plan: "free", createdAt: new Date() };

const dbMock = {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }),
  insert: (table: unknown) => ({
    values: () => ({
      onConflictDoNothing: () => ({ returning: async () => (table === users ? [NEW_USER] : []) }),
      returning: async () => [],
      then: (r: (v: unknown) => void) => Promise.resolve([]).then(r),
    }),
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve() }) }),
} as unknown as Database;

let server: Server;
let base: string;
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  app.use(cookieParser());
  app.use(captureEntry(false));
  app.use(
    createAuthRouter(dbMock, {
      googleClientId: "cid",
      googleClientSecret: "secret",
      baseUrl: "http://127.0.0.1",
      gwsClientId: "gws-cid",
      gwsClientSecret: "gws-secret",
      atlassianClientId: "atl-cid",
      atlassianClientSecret: "atl-secret",
      notionClientId: "notion-cid",
      notionClientSecret: "notion-secret",
    })
  );
  // A page, for the first landing.
  app.get("/{*path}", (_req, res) => res.type("html").send("<p>page</p>"));
  server = createServer(app);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (typeof addr === "string" || addr === null) throw new Error("no port");
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith("https://oauth2.googleapis.com/token")) {
        return new Response(JSON.stringify({ access_token: "at", expires_in: 3600 }), { status: 200 });
      }
      if (u.startsWith("https://www.googleapis.com/oauth2/v2/userinfo")) {
        return new Response(JSON.stringify({ email: "new@example.com", name: "New" }), { status: 200 });
      }
      throw new Error(`unexpected fetch in test: ${u}`);
    })
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The name=value pairs a response set, ready to send back. */
function setCookies(res: Response): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(";");
    const at = pair.indexOf("=");
    const value = pair.slice(at + 1);
    if (value) out[pair.slice(0, at)] = value;
  }
  return out;
}

const jar = (cookies: Record<string, string>) =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join("; ");

/** Begin sign-in with no decoration on the link, then come back from Google. */
async function signInUndecorated(cookies: Record<string, string>) {
  const start = await realFetch(`${base}/auth/google`, {
    redirect: "manual",
    headers: { cookie: jar(cookies), referer: `${base}/auth/login` },
  });
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const back = { ...cookies, ...setCookies(start) };
  const done = await realFetch(`${base}/auth/google/callback?code=c&state=${state}`, {
    redirect: "manual",
    headers: { cookie: jar(back) },
  });
  expect(done.status).toBe(302);
  return vi.mocked(persistAcquisition).mock.calls[0]?.[2];
}

describe("sign-in without the click decorator (SCRUM-88)", () => {
  it("takes the paid click from the analytics SDK's cookie", async () => {
    const now = Date.now();
    const analytics = encodeURIComponent(
      JSON.stringify({
        distinct_id: "0198-person",
        $sesid: [now - 60_000, "0198-session", now - 120_000],
        $initial_person_info: { r: "https://www.google.com/", u: "https://datatorag.com/?gclid=Cj0KPAID" },
      })
    );
    const attribution = await signInUndecorated({ ph_phc_example_posthog: analytics });
    expect(attribution).toMatchObject({
      gclid: "Cj0KPAID",
      referringDomain: "www.google.com",
      entryUrl: "https://datatorag.com/?gclid=Cj0KPAID",
      distinctId: "0198-person",
      sessionId: "0198-session",
    });
  });

  it("with the SDK blocked, takes the entry the server recorded at the first landing", async () => {
    const landing = await realFetch(`${base}/pricing?utm_source=newsletter&utm_medium=email`, {
      headers: { accept: "text/html", referer: "https://news.example.com/" },
    });
    const attribution = await signInUndecorated(setCookies(landing));
    expect(attribution).toMatchObject({ utmSource: "newsletter", utmMedium: "email", referringDomain: "news.example.com" });
  });

  it("with nothing to go on, persists nothing, as before", async () => {
    expect(await signInUndecorated({})).toBeNull();
  });
});
