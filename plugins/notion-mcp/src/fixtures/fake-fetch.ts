/* Test support, excluded from the build (tsconfig.json). */
import { vi } from "vitest";

export interface Answer {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

export interface SentRequest {
  method: string;
  url: URL;
  headers: Record<string, string>;
  body: unknown;
}

/** Replaces global fetch with one that answers `answers` in order, one each,
 * and records every request. A request beyond the answers fails the call, so
 * a test that expects no retry sees an extra request as an error. A string
 * body is sent as it is; anything else as JSON. */
export function fakeFetch(answers: Answer[]) {
  const sent: SentRequest[] = [];
  const queue = [...answers];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    const raw = init?.body;
    sent.push({
      method: init?.method ?? "GET",
      url: new URL(String(input)),
      headers,
      body: typeof raw === "string" ? JSON.parse(raw) : undefined,
    });
    const next = queue.shift();
    if (!next) throw new Error(`unexpected request ${init?.method ?? "GET"} ${String(input)}`);
    const text = typeof next.body === "string" ? next.body : next.body === undefined ? "" : JSON.stringify(next.body);
    return new Response(text, { status: next.status, headers: next.headers });
  });
  vi.stubGlobal("fetch", fn);
  return { sent, pending: () => queue.length };
}
