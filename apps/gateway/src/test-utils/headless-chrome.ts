import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * A real headless Chrome, driven over the DevTools protocol, for the few
 * tests whose subject is what a browser does rather than what the server
 * parses (SCRUM-472: which Origin a form POST carries depends on the page's
 * referrer policy, and no HTTP client reproduces that). No dependency: Node's
 * own WebSocket speaks the protocol.
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
  close(): Promise<void>;
}

export async function launchChrome(executable: string): Promise<Chrome> {
  const profile = mkdtempSync(path.join(tmpdir(), "dtr-chrome-"));
  const child: ChildProcess = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      // The CI runner's Ubuntu refuses the sandbox's user namespaces; the
      // browser only ever loads a page this test serves on loopback.
      "--no-sandbox",
      "--no-first-run",
      "--no-default-browser-check",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] }
  );

  const wsUrl = await new Promise<string>((resolve, reject) => {
    let seen = "";
    const timer = setTimeout(() => reject(new Error("Chrome did not open its DevTools port")), 15_000);
    child.stderr?.on("data", (chunk: Buffer) => {
      seen += chunk.toString();
      const match = seen.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Chrome exited before it was ready (${code})`));
    });
  });

  const ws = new WebSocket(wsUrl);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("could not reach Chrome's DevTools port")), { once: true });
  });

  let nextId = 1;
  const pending = new Map<number, { resolve: (v: Record<string, unknown>) => void; reject: (e: Error) => void }>();
  const bySession = new Map<string, CdpEvent[]>();
  ws.addEventListener("message", (msg) => {
    const data = JSON.parse(String(msg.data));
    if (typeof data.id === "number") {
      const waiter = pending.get(data.id);
      pending.delete(data.id);
      if (data.error) waiter?.reject(new Error(`${data.error.message}`));
      else waiter?.resolve(data.result ?? {});
      return;
    }
    if (data.sessionId) {
      const list = bySession.get(data.sessionId) ?? [];
      list.push(data);
      bySession.set(data.sessionId, list);
    }
  });

  const send: Chrome["send"] = (method, params = {}, sessionId) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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
      await send("Page.enable", {}, sessionId as string);
      await send("Network.enable", {}, sessionId as string);
      return sessionId as string;
    },
    async close() {
      ws.close();
      await new Promise<void>((resolve) => {
        if (child.exitCode !== null) return resolve();
        child.once("exit", () => resolve());
        child.kill();
      });
      rmSync(profile, { recursive: true, force: true });
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
