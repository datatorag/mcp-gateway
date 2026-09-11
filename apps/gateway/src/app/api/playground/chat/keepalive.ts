import type { UIMessageChunk } from "ai";

/**
 * Bytes on the wire while a step thinks (SCRUM-254).
 *
 * A skill run's later steps spend minutes inside the model before the first
 * tool call or word comes out, and during that time the runtime's stream
 * produces nothing. The edge in front of the gateway closes a response that
 * has been idle for 100 seconds, and the browser then reports a network
 * error while the run carries on server-side.
 *
 * WHY A TIMER AND NOT THE REASONING PARTS. The runtime forwards reasoning
 * chunks only when asked, and on the model in use the thinking blocks carry
 * no text at all (the provider returns them with the display omitted), so
 * forwarding them would carry no bytes either. A keepalive on a timer does
 * not depend on the provider, the model, the runtime's option, or on the
 * step being a model call rather than a slow tool: whenever the stream has
 * been quiet for the interval, one chunk goes out.
 *
 * The chunk is a TRANSIENT data part. The client's stream reader hands a
 * transient part to its data callback and never adds it to a message, so
 * nothing renders and nothing is persisted. The interval sits under the
 * 20 second product bound and leaves five misses of margin under the edge's
 * cut.
 *
 * This wraps OUTSIDE the instrumented stream, so a keepalive never reaches
 * the refund gate as if it were delivered content.
 */
export const KEEPALIVE_INTERVAL_MS = 15_000;

export const KEEPALIVE_CHUNK_TYPE = "data-keepalive";

export function isKeepalive(chunk: UIMessageChunk): boolean {
  return chunk.type === KEEPALIVE_CHUNK_TYPE;
}

function keepaliveChunk(): UIMessageChunk {
  return {
    type: KEEPALIVE_CHUNK_TYPE,
    data: { at: Date.now() },
    transient: true,
  } as UIMessageChunk;
}

export function withKeepalive(
  source: ReadableStream<UIMessageChunk>,
  intervalMs: number = KEEPALIVE_INTERVAL_MS
): ReadableStream<UIMessageChunk> {
  const reader = source.getReader();
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastAt = Date.now();
  let closed = false;

  const stop = () => {
    if (timer !== undefined) clearInterval(timer);
    timer = undefined;
  };

  return new ReadableStream<UIMessageChunk>({
    start(controller) {
      // One tick per interval; a tick that finds the stream recently active
      // does nothing, so the keepalive only ever fills real silence.
      timer = setInterval(() => {
        if (closed) return;
        if (Date.now() - lastAt < intervalMs) return;
        lastAt = Date.now();
        controller.enqueue(keepaliveChunk());
      }, intervalMs);

      // Pump the source in the background: a pull-driven design would only
      // read when the consumer asks, and the whole point is to speak while
      // the consumer is waiting on a read that has not settled.
      void (async () => {
        try {
          for (;;) {
            const result = await reader.read();
            if (result.done) break;
            if (closed) break;
            lastAt = Date.now();
            controller.enqueue(result.value);
          }
          if (!closed) {
            closed = true;
            stop();
            controller.close();
          }
        } catch (err) {
          if (!closed) {
            closed = true;
            stop();
            controller.error(err);
          }
        }
      })();
    },
    cancel(reason) {
      closed = true;
      stop();
      return reader.cancel(reason);
    },
  });
}
