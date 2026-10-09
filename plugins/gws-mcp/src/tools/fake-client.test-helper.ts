import { vi } from "vitest";
import type { GwsClient } from "../gws-client.js";

/** ORDER-SENSITIVE: `plan` is consumed in call order. `gmail_reply` and
 * `gmail_forward` now issue the signature lookup and the original fetch under
 * `Promise.all`, which invokes them in source order — sendAs first, then the
 * message fetch — so a plan written in that order is correct today. Reorder
 * those two inside the handler and the planned responses silently swap.
 *
 * A GwsClient stand-in shared by the tool-module test suites: `calls`
 * records every api() and helper() invocation in order (api entries carry
 * `method`, helper entries carry `command`), `plan` decides each call's
 * fate in order. */
export function fakeClient(
  plan: Array<{ data?: unknown; throws?: string; text?: string; bytes?: Uint8Array; status?: number }>
): { client: GwsClient; calls: Array<Record<string, unknown>> } {
  const calls: Array<Record<string, unknown>> = [];
  const step = () => {
    const s = plan.shift();
    if (!s) throw new Error("fake client: no planned response left");
    if (s.throws) throw new Error(s.throws);
    return s;
  };
  const next = () => ({ success: true, data: step().data });
  const api = vi.fn(async (service, resource, method, opts) => {
    calls.push({ service, resource, method, ...opts });
    return next();
  });
  const helper = vi.fn(async (service, command, flags, opts) => {
    calls.push({ service, command, flags, ...(opts ?? {}) });
    return next();
  });
  // fetchText entries carry `url`; the plan step answers with `text` and an
  // optional `status` (200 when unset).
  const fetchText = vi.fn(async (url: string) => {
    calls.push({ url });
    const s = step();
    return { status: s.status ?? 200, text: s.text ?? "" };
  });
  // gmailAttachmentToDrive entries carry `transfer`; the transport owns how
  // the bytes move, so a handler test only sees the request and the answer.
  const gmailAttachmentToDrive = vi.fn(async (transfer: Record<string, unknown>) => {
    calls.push({ transfer });
    return next();
  });
  // upload entries carry `upload` (the source is drained so a test can read
  // the bytes a handler sent); download entries carry `download`, and the
  // plan step's `bytes` (or `text`) is what the stream yields. The download
  // step is taken when the stream is opened, which for an attachment is when
  // the upload drains the message, so plan it after the steps that precede
  // the upload.
  const upload = vi.fn(async (service, resource, method, opts) => {
    const held: Buffer[] = [];
    for await (const chunk of opts.source as AsyncIterable<Uint8Array>) held.push(Buffer.from(chunk));
    const { source: _source, ...rest } = opts;
    calls.push({ upload: true, service, resource, method, ...rest, bytes: Buffer.concat(held) });
    return next();
  });
  const download = vi.fn(async (service, resource, method, params) => {
    calls.push({ download: true, service, resource, method, params });
    const s = step();
    const body = s.bytes ?? new TextEncoder().encode(s.text ?? "");
    return { stream: new Response(body as Uint8Array<ArrayBuffer>).body!, size: body.length };
  });
  return {
    client: { api, helper, fetchText, gmailAttachmentToDrive, upload, download } as unknown as GwsClient,
    calls,
  };
}

/** The JSON body a handler wrapped in its MCP response envelope. */
export const payload = (r: { content: { text: string }[] }) =>
  JSON.parse(r.content[0].text);
