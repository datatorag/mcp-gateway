import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { UIMessageChunk } from "ai";

import { KEEPALIVE_INTERVAL_MS, isKeepalive, withKeepalive } from "./keepalive";

/**
 * SCRUM-254: while a model step is in flight the response must never go
 * quiet for longer than the product bound, because the edge closes an idle
 * response and the browser reports a network error while the run carries
 * on. The source below is the shape a real step has: a step marker, then
 * nothing for two minutes, then the first word.
 */

/** The edge, as a consumer: fails the moment two chunks are further apart
 * than its idle cut. */
const PROXY_IDLE_MS = 100_000;
const PRODUCT_BOUND_MS = 20_000;

type Seen = { chunk: UIMessageChunk; at: number };

/** A source that emits `before`, waits `gapMs`, emits `after`, then closes.
 * Pull-based so the wait is a real gap in the stream, not a queued burst. */
function stallingSource(before: UIMessageChunk[], gapMs: number, after: UIMessageChunk[]) {
  let index = 0;
  const all = [...before, ...after];
  return new ReadableStream<UIMessageChunk>({
    async pull(controller) {
      if (index === before.length && gapMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, gapMs));
        gapMs = 0;
      }
      if (index < all.length) {
        controller.enqueue(all[index++]!);
        return;
      }
      controller.close();
    },
  });
}

/** Reads a stream to the end under fake timers, recording when each chunk
 * arrived and failing if the proxy would have cut the connection. */
async function readThroughProxy(stream: ReadableStream<UIMessageChunk>): Promise<Seen[]> {
  const seen: Seen[] = [];
  const reader = stream.getReader();
  let last = Date.now();
  for (;;) {
    const next = reader.read();
    // Advance the clock in small steps until the read settles, the way the
    // real clock would; the proxy's cut is asserted on the gaps that result.
    let settled: ReadableStreamReadResult<UIMessageChunk> | undefined;
    void next.then((r) => { settled = r; });
    while (settled === undefined) {
      await vi.advanceTimersByTimeAsync(1_000);
      if (settled === undefined && Date.now() - last > PROXY_IDLE_MS) {
        throw new Error(`proxy cut the connection after ${Date.now() - last} ms of silence`);
      }
    }
    if (settled.done) return seen;
    seen.push({ chunk: settled.value, at: Date.now() });
    last = Date.now();
  }
}

const STEP_START: UIMessageChunk[] = [{ type: "start" }, { type: "start-step" }];
const STEP_END: UIMessageChunk[] = [
  { type: "text-start", id: "t1" },
  { type: "text-delta", id: "t1", delta: "Done." },
  { type: "text-end", id: "t1" },
  { type: "finish-step" },
  { type: "finish" },
];

describe("withKeepalive (SCRUM-254)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("the interval sits under the product bound with margin under the edge's idle cut", () => {
    expect(KEEPALIVE_INTERVAL_MS).toBeLessThan(PRODUCT_BOUND_MS);
    expect(KEEPALIVE_INTERVAL_MS * 5).toBeLessThan(PROXY_IDLE_MS);
  });

  it("a step that is silent for 120 seconds still reaches the client through a 100 second idle proxy", async () => {
    const source = stallingSource(STEP_START, 120_000, STEP_END);
    const seen = await readThroughProxy(withKeepalive(source));

    const gaps = seen.slice(1).map((s, i) => s.at - seen[i]!.at);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(PRODUCT_BOUND_MS);

    const keepalives = seen.filter((s) => isKeepalive(s.chunk));
    expect(keepalives.length).toBeGreaterThanOrEqual(5);
    // Every keepalive is a transient data part: the client never adds it to
    // a message and nothing about it is persisted.
    for (const k of keepalives) {
      expect(k.chunk).toMatchObject({ type: "data-keepalive", transient: true });
    }
    // The source's own chunks all arrive, in order, untouched.
    const own = seen.filter((s) => !isKeepalive(s.chunk)).map((s) => s.chunk);
    expect(own).toEqual([...STEP_START, ...STEP_END]);
  });

  it("stays quiet while the source is talking, and stops when the source ends", async () => {
    const source = stallingSource(STEP_START, 0, STEP_END);
    const seen = await readThroughProxy(withKeepalive(source));
    expect(seen.some((s) => isKeepalive(s.chunk))).toBe(false);
    // Nothing keeps ticking after the stream closed.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("a cancel from the client reaches the source and clears the timer", async () => {
    let cancelled: unknown = null;
    const source = new ReadableStream<UIMessageChunk>({
      pull() {
        return new Promise(() => {});
      },
      cancel(reason) {
        cancelled = reason;
      },
    });
    const wrapped = withKeepalive(source);
    const reader = wrapped.getReader();
    const pending = reader.read();
    await vi.advanceTimersByTimeAsync(KEEPALIVE_INTERVAL_MS + 1);
    await expect(pending).resolves.toMatchObject({ value: { type: "data-keepalive" } });
    await reader.cancel("viewer left");
    expect(cancelled).toBe("viewer left");
    expect(vi.getTimerCount()).toBe(0);
  });
});
