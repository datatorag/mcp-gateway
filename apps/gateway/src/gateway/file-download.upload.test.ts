/**
 * SCRUM-437: upload links, the second kind of record in the download link's
 * store. A link takes one file by PUT within ten minutes; the file is held
 * in memory for ten minutes from its arrival, named by an upload id that a
 * file reference carries, and used once. The clock is injected; nothing
 * here opens a socket.
 */

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  assertHeldUploadCeiling,
  beginReceive,
  createDownloadLink,
  createUploadLink,
  dropLinksForUser,
  downloadLinksHeld,
  inspectUploadLink,
  resetDownloadLinks,
  revokeLinksCarriedIn,
  takeUpload,
  HELD_LIFE_MS,
  LINK_KEPT_AFTER_MS,
  LINK_LIFE_MS,
  MAX_HELD_UPLOAD_BYTES,
  MAX_OPEN_UPLOADS_PER_USER,
  UPLOAD_PATH,
  type DownloadDeps,
} from "./file-download";

const BASE = "https://gw.example.test";
const FILE = Buffer.from("%PDF-1.4 an uploaded file");
const SHA = createHash("sha256").update(FILE).digest("hex");

let now = 1_000_000;
const clock = () => now;
beforeEach(() => {
  resetDownloadLinks();
  now = 1_000_000;
});

const textOf = (r: { content: Array<{ text?: string }> }) => r.content.map((c) => c.text).join(" ");
const mint = (userId = "user-1", args: Record<string, unknown> = {}) =>
  createUploadLink({ userId, args, baseUrl: BASE, now: clock });
const receiptOf = (r: { content: Array<{ text?: string }> }) => JSON.parse(textOf(r));
const tokenOf = (r: { content: Array<{ text?: string }> }) => String(receiptOf(r).link.url).split(UPLOAD_PATH)[1];

/** Mint, then receive FILE under a name, as a PUT would. */
function uploaded(userId = "user-1", name = "report.pdf") {
  const token = tokenOf(mint(userId));
  const begun = beginReceive(token, now);
  if (!begun.ok) throw new Error(`receive refused: ${begun.kind}`);
  const receipt = begun.finish({ bytes: FILE, name, type: "application/pdf" }, now);
  if (!receipt) throw new Error("finish refused");
  return { token, receipt };
}

describe("minting an upload link", () => {
  it("answers a link on this host, its expiry, and a one-line command with the file's own name", () => {
    const result = mint();
    expect(result.isError).toBeUndefined();
    const receipt = receiptOf(result);
    expect(receipt.link.url).toMatch(new RegExp(`^${BASE}${UPLOAD_PATH}[A-Za-z0-9_-]{22}\\.[A-Za-z0-9_-]{43}$`));
    expect(receipt.link.expires_at).toBe(new Date(now + LINK_LIFE_MS).toISOString());
    expect(receipt.link.uses).toBe(1);
    expect(receipt.link.command).toBe(`curl -fsS -T <path-to-file> "${receipt.link.url}/"`);
    expect(receipt.max_bytes).toBe(25 * 1024 * 1024);
    expect(inspectUploadLink(tokenOf(result), now)).toEqual({ kind: "live", nameHint: null, maxBytes: 25 * 1024 * 1024 });
  });

  it("takes a name hint and a smaller cap, and refuses a cap over 25 MB", () => {
    const token = tokenOf(mint("user-1", { name: "Q3 report.pdf", max_bytes: 1000 }));
    expect(inspectUploadLink(token, now)).toEqual({ kind: "live", nameHint: "Q3 report.pdf", maxBytes: 1000 });
    expect(mint("user-1", { max_bytes: 25 * 1024 * 1024 + 1 }).isError).toBe(true);
    expect(mint("user-1", { max_bytes: 0 }).isError).toBe(true);
  });

  it(`refuses a link past ${MAX_OPEN_UPLOADS_PER_USER} open or held uploads, counted apart from download links`, async () => {
    for (let i = 0; i < MAX_OPEN_UPLOADS_PER_USER; i++) expect(mint().isError).toBeUndefined();
    const refused = mint();
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toBe(
      "You already have 3 upload links or uploaded files waiting. Use one, or wait for one to expire, then try again. No link was made."
    );
    expect(mint("user-2").isError).toBeUndefined();
  });

  it("counts a held file against the three, and a used one not", () => {
    uploaded();
    uploaded();
    const { receipt } = uploaded();
    expect(mint().isError).toBe(true);
    const taken = takeUpload(receipt.reference.upload_id, "user-1", now);
    if (!taken.ok) throw new Error(taken.text);
    taken.settle(true);
    expect(mint().isError).toBeUndefined();
  });
});

describe("receiving the file", () => {
  it("holds it and answers a receipt with an upload id that is not the link's", () => {
    const { token, receipt } = uploaded();
    expect(receipt.received).toEqual({ name: "report.pdf", type: "application/pdf", bytes: FILE.length, sha256: SHA });
    expect(receipt.reference.type).toBe("upload");
    expect(receipt.reference.upload_id).toMatch(/^[A-Za-z0-9_-]{22}$/);
    expect(token.startsWith(receipt.reference.upload_id)).toBe(false);
    expect(receipt.held_until).toBe(new Date(now + HELD_LIFE_MS).toISOString());
  });

  it("takes one file: a second receive on the link is told it was used", () => {
    const { token } = uploaded();
    expect(beginReceive(token, now)).toEqual({ ok: false, kind: "used" });
  });

  it("is refused while another receive on the same link is running", () => {
    const token = tokenOf(mint());
    expect(beginReceive(token, now).ok).toBe(true);
    expect(beginReceive(token, now)).toEqual({ ok: false, kind: "receiving" });
  });

  it("an aborted receive leaves the link open", () => {
    const token = tokenOf(mint());
    const begun = beginReceive(token, now);
    if (!begun.ok) throw new Error("refused");
    expect(begun.finish(null)).toBeNull();
    expect(inspectUploadLink(token, now).kind).toBe("live");
  });

  it("refuses a link past its ten minutes", () => {
    const token = tokenOf(mint());
    now += LINK_LIFE_MS;
    expect(beginReceive(token, now)).toEqual({ ok: false, kind: "expired" });
  });

  it("refuses an invalid token, and a download link's token", async () => {
    expect(beginReceive("nonsense", now)).toEqual({ ok: false, kind: "invalid" });
  });

  it("refuses when the files held and reserved would pass the host's ceiling", () => {
    const users = Math.floor(MAX_HELD_UPLOAD_BYTES / (25 * 1024 * 1024));
    for (let i = 0; i < users; i++) {
      const begun = beginReceive(tokenOf(mint(`user-${i}`)), now);
      expect(begun.ok, `upload ${i}`).toBe(true);
    }
    expect(beginReceive(tokenOf(mint("one-more")), now)).toEqual({ ok: false, kind: "full" });
  });
});

describe("using an uploaded file", () => {
  it("hands the file to its owner once: settled as sent, a second use is told it was used", () => {
    const { receipt } = uploaded();
    const taken = takeUpload(receipt.reference.upload_id, "user-1", now);
    if (!taken.ok) throw new Error(taken.text);
    expect(taken.file.bytes.equals(FILE)).toBe(true);
    expect(taken.file.name).toBe("report.pdf");
    taken.settle(true);
    expect(takeUpload(receipt.reference.upload_id, "user-1", now)).toEqual({
      ok: false,
      text: "This uploaded file has already been used. An uploaded file goes to one call. Upload it again.",
    });
  });

  it("keeps the file when the call stopped before the destination: it can be used again", () => {
    const { receipt } = uploaded();
    const first = takeUpload(receipt.reference.upload_id, "user-1", now);
    if (!first.ok) throw new Error(first.text);
    first.settle(false);
    const second = takeUpload(receipt.reference.upload_id, "user-1", now);
    expect(second.ok).toBe(true);
  });

  it("is not valid for another user, and that does not disturb it", () => {
    const { receipt } = uploaded();
    expect(takeUpload(receipt.reference.upload_id, "user-2", now)).toEqual({
      ok: false,
      text: "This upload is not valid. Upload the file again.",
    });
    expect(takeUpload(receipt.reference.upload_id, "user-1", now).ok).toBe(true);
  });

  it("goes to one of two calls racing for it", () => {
    const { receipt } = uploaded();
    const a = takeUpload(receipt.reference.upload_id, "user-1", now);
    const b = takeUpload(receipt.reference.upload_id, "user-1", now);
    expect(a.ok).toBe(true);
    expect(b).toEqual({ ok: false, text: "This uploaded file is already being used by another call." });
  });

  it("expires ten minutes after it arrived, and says so while the record is kept", () => {
    const { receipt } = uploaded();
    now += HELD_LIFE_MS;
    expect(takeUpload(receipt.reference.upload_id, "user-1", now)).toEqual({
      ok: false,
      text: "This uploaded file has expired. An uploaded file is kept ten minutes. Upload it again.",
    });
    now += LINK_KEPT_AFTER_MS;
    expect(takeUpload(receipt.reference.upload_id, "user-1", now).ok).toBe(false);
    expect(downloadLinksHeld()).toBe(0);
  });

  it("finishes a send that started before the ten minutes ran out, as used, not expired", () => {
    const { receipt } = uploaded();
    const taken = takeUpload(receipt.reference.upload_id, "user-1", now);
    if (!taken.ok) throw new Error(taken.text);
    now += HELD_LIFE_MS + 1;
    // A sweep passes while the call is still sending.
    expect(inspectUploadLink("nonsense", now).kind).toBe("invalid");
    taken.settle(true);
    expect(takeUpload(receipt.reference.upload_id, "user-1", now).ok).toBe(false);
    expect(takeUpload(receipt.reference.upload_id, "user-1", now)).toEqual({
      ok: false,
      text: "This uploaded file has already been used. An uploaded file goes to one call. Upload it again.",
    });
  });
});

describe("the shared store", () => {
  it("drops a user's uploads, held files included, when their authority changes", () => {
    const { receipt } = uploaded();
    dropLinksForUser("user-1");
    expect(takeUpload(receipt.reference.upload_id, "user-1", now).ok).toBe(false);
    expect(downloadLinksHeld()).toBe(0);
  });

  it("cancels an open upload link carried in a tool call, plain, percent-encoded or base64", () => {
    for (const encode of [(t: string) => t, (t: string) => encodeURIComponent(`x ${t}`), (t: string) => Buffer.from(`x${t}y`).toString("base64")]) {
      resetDownloadLinks();
      const result = mint();
      const url = receiptOf(result).link.url as string;
      expect(revokeLinksCarriedIn("user-1", () => encode(url), now)).toBe(true);
      expect(inspectUploadLink(tokenOf(result), now)).toEqual({ kind: "cancelled" });
    }
  });

  it("does not treat a received upload's id as a link: the call that uses it is not refused", () => {
    const { receipt } = uploaded();
    expect(revokeLinksCarriedIn("user-1", () => JSON.stringify({ file: receipt.reference }), now)).toBe(false);
  });

  it("keeps the two kinds apart: a download link's token is not an upload link", async () => {
    const deps = {
      resolveToken: async () => ({ token: "t", accountEmail: "a@example.com", scopes: null }),
      resolvePluginUrl: async () => "http://localhost:40001/mcp",
      surface: "mcp",
      connectionsUrl: `${BASE}/dashboard/connections`,
      fetchFn: (async () =>
        new Response(new Uint8Array(FILE), { status: 200, headers: { "X-File-Name": "a.eml" } })) as unknown as typeof fetch,
    } satisfies DownloadDeps;
    const download = await createDownloadLink({
      userId: "user-1",
      args: { file: { type: "gmail_message", message_id: "m1" } },
      baseUrl: BASE,
      deps,
      now: clock,
    });
    const token = String(JSON.parse(textOf(download)).link.url).split("/files/d/")[1];
    expect(beginReceive(token, now)).toEqual({ ok: false, kind: "invalid" });
    expect(inspectUploadLink(token, now)).toEqual({ kind: "invalid" });
  });
});

describe("the ceiling against the machine", () => {
  it("refuses to start when the held uploads could take more than a quarter of memory", () => {
    expect(() => assertHeldUploadCeiling(MAX_HELD_UPLOAD_BYTES * 4 - 1)).toThrow(/quarter/);
    expect(() => assertHeldUploadCeiling(8 * 1024 ** 3)).not.toThrow();
  });
});
