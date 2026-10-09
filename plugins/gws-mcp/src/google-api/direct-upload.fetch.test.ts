import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
import { RESUMABLE_CHUNK, directUpload } from "./direct-upload.js";
import { sendAuthorized } from "./direct-transport.js";

/**
 * The resumable upload through Node's REAL fetch (SCRUM-289).
 *
 * The other upload tests replace `fetch` itself, so they never ran fetch's
 * own handling of the answer. That is where production failed: Google
 * answers every intermediate chunk with 308 Resume Incomplete, fetch treats
 * a 308 as a redirect, and with `redirect: "error"` a redirect is a network
 * error. Every upload big enough to be resumable died on its first chunk with
 * a bare TypeError ("unexpected redirect"), on every Node version.
 *
 * Here the global dispatcher is swapped for an undici MockAgent that answers
 * as Google does. Redirect handling lives in fetch above the dispatcher, so
 * this runs the same code path production did, with no network.
 */

const TOKEN = "ya29.SECRET-bearer-real-fetch";
const ORIGIN = "https://www.googleapis.com";
const SESSION_PATH = "/upload/drive/v3/files?uploadType=resumable&upload_id=real-fetch";

async function* bytes(total: number): AsyncGenerator<Uint8Array> {
  const step = 1_000_003;
  for (let sent = 0; sent < total; sent += step) {
    const n = Math.min(step, total - sent);
    const b = Buffer.alloc(n);
    for (let i = 0; i < n; i++) b[i] = (sent + i) % 251;
    yield b;
  }
}

let previous: Dispatcher;
let agent: MockAgent;

beforeEach(() => {
  previous = getGlobalDispatcher();
  agent = new MockAgent();
  agent.disableNetConnect();
  setGlobalDispatcher(agent);
});

afterEach(async () => {
  setGlobalDispatcher(previous);
  await agent.close();
});

describe("a resumable upload through the real fetch", () => {
  it("takes Google's 308 Resume Incomplete as progress, not as a redirect", async () => {
    const total = RESUMABLE_CHUNK + 4321; // two chunks: one 308, then the final 200
    const google = agent.get(ORIGIN);
    const received: Buffer[] = [];

    google
      .intercept({ path: (p) => p.startsWith("/resumable/upload/drive/v3/files"), method: "POST" })
      .reply(200, "", { headers: { location: `${ORIGIN}${SESSION_PATH}` } });
    google
      .intercept({ path: SESSION_PATH, method: "PUT" })
      .reply(({ body }) => {
        received.push(Buffer.from(body as Uint8Array));
        return { statusCode: 308, data: "", responseOptions: { headers: { range: `bytes=0-${RESUMABLE_CHUNK - 1}` } } };
      });
    google
      .intercept({ path: SESSION_PATH, method: "PUT" })
      .reply(({ body }) => {
        received.push(Buffer.from(body as Uint8Array));
        return { statusCode: 200, data: JSON.stringify({ id: "uploaded" }) };
      });

    const out = await directUpload(TOKEN, "drive", "files", "create", {
      metadata: { name: "big.mp4" },
      contentType: "video/mp4",
      source: bytes(total),
    });
    expect(out.data).toEqual({ id: "uploaded" });
    expect(Buffer.concat(received).length).toBe(total);
  });

  it("still refuses a real redirect: a 308 that names a Location is not progress", async () => {
    const google = agent.get(ORIGIN);
    google
      .intercept({ path: (p) => p.startsWith("/resumable/upload/drive/v3/files"), method: "POST" })
      .reply(200, "", { headers: { location: `${ORIGIN}${SESSION_PATH}` } });
    google
      .intercept({ path: SESSION_PATH, method: "PUT" })
      .reply(308, "", { headers: { location: "https://elsewhere.example/steal", range: `bytes=0-${RESUMABLE_CHUNK - 1}` } });

    await expect(
      directUpload(TOKEN, "drive", "files", "create", {
        metadata: { name: "big.mp4" },
        contentType: "video/mp4",
        source: bytes(RESUMABLE_CHUNK + 10),
      })
    ).rejects.toThrow(/redirect/i);
  });

  it("the uploadSession destination refuses a redirect itself, whoever calls it", async () => {
    // The refusal lives in sendAuthorized, so a future caller that picks this
    // destination cannot forget it. A Location-free 308 is the only 3xx that
    // comes back; a 302, or a 308 naming somewhere, is refused unfollowed.
    const google = agent.get(ORIGIN);
    google.intercept({ path: "/upload/a", method: "PUT" }).reply(302, "", { headers: { location: "https://elsewhere.example/" } });
    google.intercept({ path: "/upload/b", method: "PUT" }).reply(308, "", { headers: { location: "https://elsewhere.example/" } });
    google.intercept({ path: "/upload/c", method: "PUT" }).reply(308, "", { headers: { range: "bytes=0-9" } });
    const put = (path: string) =>
      sendAuthorized(TOKEN, { method: "PUT", url: `${ORIGIN}${path}` }, "t", {
        body: Buffer.from("0123456789"),
        timeout: 5000,
        destination: "uploadSession",
      });
    await expect(put("/upload/a")).rejects.toThrow(/redirect \(302\)/);
    await expect(put("/upload/b")).rejects.toThrow(/redirect \(308\)/);
    const ok = await put("/upload/c");
    expect(ok.status).toBe(308);
    await ok.body?.cancel();
  });

  it("refuses a 308 whose Range says Google holds fewer bytes than were sent", async () => {
    const google = agent.get(ORIGIN);
    google
      .intercept({ path: (p) => p.startsWith("/resumable/upload/drive/v3/files"), method: "POST" })
      .reply(200, "", { headers: { location: `${ORIGIN}${SESSION_PATH}` } });
    google
      .intercept({ path: SESSION_PATH, method: "PUT" })
      .reply(308, "", { headers: { range: "bytes=0-1023" } });

    await expect(
      directUpload(TOKEN, "drive", "files", "create", {
        metadata: { name: "big.mp4" },
        contentType: "video/mp4",
        source: bytes(RESUMABLE_CHUNK + 10),
      })
    ).rejects.toThrow(/received|range/i);
  });
});
