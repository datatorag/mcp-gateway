import { spawn, type ChildProcess } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A real headless Chrome, driven over the DevTools protocol, for the few
 * tests whose subject is what a browser does rather than what the server
 * parses (SCRUM-472: which Origin a form POST carries depends on the page's
 * referrer policy, and no HTTP client reproduces that). No dependency: the
 * protocol runs over a pipe to the browser.
 *
 * Chrome is looked for at CHROME_PATH, then where macOS and the CI runner
 * keep it. With none, `findChrome` answers null and the suite skips.
 */
const CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

export function findChrome(): string | null {
  const fromEnv = process.env.CHROME_PATH;
  if (fromEnv) return existsSync(fromEnv) ? fromEnv : null;
  return CANDIDATES.find((p) => existsSync(p)) ?? null;
}

type CdpEvent = { method: string; params: Record<string, unknown>; sessionId?: string };

export interface Chrome {
  /** One protocol call; `sessionId` addresses a page attached with `newPage`. */
  send(method: string, params?: Record<string, unknown>, sessionId?: string): Promise<Record<string, unknown>>;
  /** Every event seen so far and from now on, for one page. */
  events(sessionId: string): CdpEvent[];
  /** A blank page with the network domain on, ready to navigate. */
  newPage(): Promise<string>;
  /** Closes a page from `newPage`; its later events are no longer recorded. */
  closePage(sessionId: string): Promise<void>;
  close(): Promise<void>;
}

export async function launchChrome(executable: string): Promise<Chrome> {
  const profile = mkdtempSync(path.join(tmpdir(), "dtr-chrome-"));
  // The protocol over a pipe, not a port: Chrome reads commands on fd 3 and
  // writes replies on fd 4, each a JSON message ended by a NUL byte. Node 20,
  // which CI runs, has no global WebSocket.
  const child: ChildProcess = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-pipe",
      `--user-data-dir=${profile}`,
      // The CI runner's Ubuntu refuses the sandbox's user namespaces; the
      // browser only ever loads a page this test serves on loopback.
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "ignore", "pipe", "pipe"] }
  );
  const toChrome = child.stdio[3] as Writable;
  const fromChrome = child.stdio[4] as Readable;

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  const bySession = new Map<string, CdpEvent[]>();
  const targets = new Map<string, string>();
  let buffered = "";
  fromChrome.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    let end: number;
    while ((end = buffered.indexOf("\0")) !== -1) {
      const data = JSON.parse(buffered.slice(0, end));
      buffered = buffered.slice(end + 1);
      if (typeof data.id === "number") {
        const waiter = pending.get(data.id);
        pending.delete(data.id);
        if (data.error) waiter?.reject(new Error(`${data.error.message}`));
        else waiter?.resolve(data.result ?? {});
      } else if (data.sessionId) {
        const list = bySession.get(data.sessionId) ?? [];
        list.push(data);
        bySession.set(data.sessionId, list);
      }
    }
  });
  child.on("exit", (code) => {
    for (const waiter of pending.values()) waiter.reject(new Error(`Chrome exited (${code})`));
    pending.clear();
  });

  const send: Chrome["send"] = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      toChrome.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
    });

  return {
    send,
    events: (sessionId) => {
      const list = bySession.get(sessionId) ?? [];
      bySession.set(sessionId, list);
      return list;
    },
    async newPage() {
      const { targetId } = await send("Target.createTarget", { url: "about:blank" });
      const { sessionId } = await send("Target.attachToTarget", { targetId, flatten: true });
      targets.set(sessionId as string, targetId as string);
      await send("Page.enable", {}, sessionId as string);
      await send("Network.enable", {}, sessionId as string);
      return sessionId as string;
    },
    async closePage(sessionId) {
      const targetId = targets.get(sessionId);
      targets.delete(sessionId);
      if (targetId) await send("Target.closeTarget", { targetId }).catch(() => undefined);
    },
    async close() {
      toChrome.end();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null || child.signalCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill();
      });
      // Chrome's helper processes can still be writing into the profile for a
      // moment after the browser exits, and the removal then meets a directory
      // that is not empty (seen once in CI). Retried, and never a test
      // failure: a leftover directory in the temp dir harms nothing.
      try {
        rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      } catch (e) {
        console.warn(`[headless-chrome] profile left behind: ${(e as Error).message}`);
      }
    },
  };
}

/** Waits until `test` finds something in the page's events, or fails after `ms`. */
export async function waitForEvent<T>(
  chrome: Chrome,
  sessionId: string,
  test: (events: CdpEvent[]) => T | undefined,
  ms = 10_000
): Promise<T> {
  const until = Date.now() + ms;
  for (;;) {
    const found = test(chrome.events(sessionId));
    if (found !== undefined) return found;
    if (Date.now() > until) throw new Error("timed out waiting for the browser");
    await new Promise((r) => setTimeout(r, 25));
  }
}
