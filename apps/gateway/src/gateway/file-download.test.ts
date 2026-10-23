/**
 * SCRUM-420: the download link's store and its two reads. Everything the
 * reads touch is injected (fetch, the token resolver, the plugin lookup, the
 * clock), so nothing here opens a socket.
 */

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDownloadLink,
  downloadType,
  dropLinksForUser,
  downloadLinksHeld,
  inspectLink,
  redeemDownloadLink,
  resetDownloadLinks,
  revokeLinksCarriedIn,
  safeDownloadName,
  DOWNLOAD_PATH,
  LINK_KEPT_AFTER_MS,
  LINK_LIFE_MS,
  MAX_OPEN_LINKS_PER_USER,
  MAX_RECORDS_PER_USER,
  type DownloadDeps,
  type RedeemOutcome,
} from "./file-download";
import { downloadsInFlight, transfersInFlight } from "./file-crossing";

/** The check, on text already serialised. */
const carried = (userId: string, text: string, now?: number) => revokeLinksCarriedIn(userId, () => text, now);

const BASE = "https://gw.example.test";
const FILE = Buffer.from("From: a@example.com\r\nSubject: fixture\r\n\r\nbody\r\n");
const SHA = createHash("sha256").update(FILE).digest("hex");
const GRANT = "openid https://www.googleapis.com/auth/gmail.modify";

type Source = (init: RequestInit) => Response | Promise<Response>;

const sourceOk =
  (bytes: Buffer = FILE, name = "Quarterly report.eml", type = "message/rfc822"): Source =>
  () =>
    new Response(new Uint8Array(bytes), {
      status: 200,
      headers: { "Content-Type": type, "X-File-Name": encodeURIComponent(name) },
    });

function world(over: { source?: Source; connected?: boolean } = {}) {
  const state = { source: over.source ?? sourceOk(), connected: over.connected ?? true, now: 1_000_000, reads: 0 };
  const sourceBodies: string[] = [];
  const deps: DownloadDeps = {
    resolveToken: vi.fn(async () =>
      state.connected ? { token: "source-token-fixture", accountEmail: "a@example.com", scopes: GRANT } : null
    ) as DownloadDeps["resolveToken"],
    resolvePluginUrl: async () => "http://localhost:40001/mcp",
    surface: "mcp",
    connectionsUrl: `${BASE}/dashboard/connections`,
    fetchFn: (async (_url: string | URL, init: RequestInit = {}) => {
      state.reads += 1;
      sourceBodies.push(String(init.body));
      return state.source(init);
    }) as unknown as typeof fetch,
  };
  const mint = (userId = "user-1", args: Record<string, unknown> = { file: { type: "gmail_message", message_id: "m1" } }) =>
    createDownloadLink({ userId, args, baseUrl: BASE, deps, now: () => state.now });
  const redeem = (token: string, send: (f: Extract<RedeemOutcome, { kind: "send" }>) => Promise<void> = async () => {}) =>
    redeemDownloadLink(token, () => deps, send, () => state.now);
  return { state, deps, mint, redeem, sourceBodies };
}

const textOf = (r: { content: Array<{ text?: string }> }) => r.content.map((c) => c.text).join(" ");
const receiptOf = (r: { content: Array<{ text?: string }> }) => JSON.parse(textOf(r));
const tokenOf = (r: { content: Array<{ text?: string }> }) => String(receiptOf(r).link.url).split(DOWNLOAD_PATH)[1];

beforeEach(() => resetDownloadLinks());

describe("the tool call", () => {
  it("answers a receipt with the name, the size, the SHA-256 and a link on this host", async () => {
    const w = world();
    const result = await w.mint();
    expect(result.isError).toBeUndefined();
    const receipt = receiptOf(result);
    expect(receipt.file).toEqual({ name: "Quarterly report.eml", type: "message/rfc822" });
    expect(receipt.sent).toEqual({ bytes: FILE.length, sha256: SHA });
    expect(receipt.link.url).toMatch(/^https:\/\/gw\.example\.test\/files\/d\/[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}$/);
    expect(receipt.link.uses).toBe(1);
    expect(Date.parse(receipt.link.expires_at)).toBe(w.state.now + LINK_LIFE_MS);
    expect(receipt.link.markdown).toBe(`[Download Quarterly report.eml](${receipt.link.url})`);
    expect(receipt.link.command).toBe(`curl -f -X POST -OJ ${receipt.link.url}`);
  });

  it("does not return the file, and holds none of it after the call", async () => {
    const w = world();
    const result = await w.mint();
    expect(textOf(result)).not.toContain("Subject: fixture");
    expect(textOf(result)).not.toContain(FILE.toString("base64"));
    expect(transfersInFlight()).toEqual({ host: 0, users: 0 });
  });

  it("carries nothing in the URL but the token: no message id, no name, no user", async () => {
    const w = world();
    // Long enough that a random token cannot contain them by chance: a two
    // character id did, about once in a few hundred runs.
    const minted = await w.mint("user-fixture-0001", { file: { type: "gmail_message", message_id: "message-fixture-0001" } });
    const url = String(receiptOf(minted).link.url);
    for (const secret of ["message-fixture-0001", "Quarterly", "user-fixture-0001"]) expect(url).not.toContain(secret);
    expect(new URL(url).search).toBe("");
  });

  it("sends the source a reference closed to its type's fields", async () => {
    const w = world();
    await w.mint("user-1", { file: { type: "gmail_message", message_id: "m1", account: "a@example.com", extra: "x" } });
    expect(JSON.parse(w.sourceBodies[0]).ref).toEqual({ type: "gmail_message", message_id: "m1" });
  });

  it("a file name cannot close the markdown label and open a second link", async () => {
    const w = world({ source: sourceOk(FILE, "a](https://evil.example/x) [b.eml") });
    const { markdown, url } = receiptOf(await w.mint()).link;
    expect(markdown.match(/\]\(/g)).toHaveLength(1);
    expect(markdown.endsWith(`](${url})`)).toBe(true);
  });

  it.each([
    ["no file", {}],
    ["an unknown type", { file: { type: "url", url: "https://example.com/x" } }],
    ["a missing field", { file: { type: "gmail_attachment", message_id: "m1" } }],
  ])("refuses %s before any read", async (_label, args) => {
    const w = world();
    const result = await w.mint("user-1", args);
    expect(result.isError).toBe(true);
    expect(w.state.reads).toBe(0);
    expect(downloadLinksHeld()).toBe(0);
  });

  it("says no link was made, not that nothing was uploaded", async () => {
    const w = world({ source: () => Response.json({ error: "Gmail has no message with that id.", code: "not_found" }, { status: 404 }) });
    const result = await w.mint();
    expect(result.isError).toBe(true);
    expect(textOf(result)).toContain("no link was made");
    expect(textOf(result)).not.toMatch(/upload/i);
    expect(downloadLinksHeld()).toBe(0);
  });

  it.each([
    ["content", { type: "content", name: "a.png", base64: "iVBO" }],
    ["upload", { type: "upload", upload_id: "u1" }],
  ])("refuses a %s reference without a read: the file is already on the caller's side", async (_label, file) => {
    const w = world();
    const result = await w.mint("user-1", { file });
    expect(result.isError).toBe(true);
    expect(textOf(result)).toBe(
      "This file is already on your side; a download link is for files in a connected service. No link was made."
    );
    expect(w.state.reads).toBe(0);
    expect(downloadLinksHeld()).toBe(0);
  });

  it("refuses when this service does not know its own address", async () => {
    const w = world();
    const result = await createDownloadLink({ userId: "u", args: { file: { type: "gmail_message", message_id: "m1" } }, baseUrl: "", deps: w.deps });
    expect(result.isError).toBe(true);
    expect(w.state.reads).toBe(0);
  });

  it(`refuses a link past ${MAX_OPEN_LINKS_PER_USER} open ones, without a read, and another user is not affected`, async () => {
    const w = world();
    for (let i = 0; i < MAX_OPEN_LINKS_PER_USER; i++) expect((await w.mint()).isError).toBeUndefined();
    const reads = w.state.reads;
    const refused = await w.mint();
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("No link was made");
    expect(w.state.reads).toBe(reads);
    expect((await w.mint("user-2")).isError).toBeUndefined();
  });

  it(`holds at most ${MAX_RECORDS_PER_USER} records for one user, so mint-and-spend cannot fill the store`, async () => {
    const w = world();
    for (let i = 0; i < MAX_RECORDS_PER_USER; i++) {
      const minted = await w.mint();
      expect(minted.isError).toBeUndefined();
      expect((await w.redeem(tokenOf(minted))).kind).toBe("send");
    }
    const refused = await w.mint();
    expect(refused.isError).toBe(true);
    expect(textOf(refused)).toContain("in a short time");
    expect(downloadLinksHeld()).toBe(MAX_RECORDS_PER_USER);
    // Once the oldest have lapsed there is room again.
    w.state.now += LINK_LIFE_MS + LINK_KEPT_AFTER_MS;
    expect((await w.mint()).isError).toBeUndefined();
  });
});

describe("a GET", () => {
  it("says what the link is and spends nothing, however often", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    for (let i = 0; i < 5; i++) {
      expect(inspectLink(token, w.state.now)).toEqual({ kind: "live", name: "Quarterly report.eml", bytes: FILE.length });
    }
    expect(w.state.reads).toBe(1);
    expect((await w.redeem(token)).kind).toBe("send");
  });

  it.each(["", "nonsense", "a.b", `${"A".repeat(22)}.${"B".repeat(43)}`])("calls %j not valid", (token) => {
    expect(inspectLink(token)).toEqual({ kind: "invalid" });
  });

  it("refuses a real nonce with another link's tag", async () => {
    const w = world();
    const [a, b] = [tokenOf(await w.mint()), tokenOf(await w.mint())];
    const crossed = `${a.split(".")[0]}.${b.split(".")[1]}`;
    expect(inspectLink(crossed, w.state.now)).toEqual({ kind: "invalid" });
    expect((await w.redeem(crossed)).kind).toBe("invalid");
  });
});

describe("a POST", () => {
  it("reads the file again and hands over exactly the bytes of the receipt, typed by us", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    const sent: Buffer[] = [];
    const outcome = await w.redeem(token, async (file) => {
      sent.push(file.bytes);
      expect(file).toMatchObject({ name: "Quarterly report.eml", type: "message/rfc822", userId: "user-1" });
      // The slot is held while the bytes are being written.
      expect(downloadsInFlight()).toBe(1);
    });
    expect(outcome.kind).toBe("send");
    expect(sent).toHaveLength(1);
    expect(sent[0].equals(FILE)).toBe(true);
    expect(w.state.reads).toBe(2);
    expect(downloadsInFlight()).toBe(0);
  });

  it("sends an attachment as an opaque type, whatever the sender declared", async () => {
    const w = world({ source: sourceOk(FILE, "page.html", "text/html") });
    const minted = await w.mint("user-1", { file: { type: "gmail_attachment", message_id: "m1", part_id: "1" } });
    expect(receiptOf(minted).file.type).toBe("text/html");
    let type = "";
    await w.redeem(tokenOf(minted), async (file) => void (type = file.type));
    expect(type).toBe("application/octet-stream");
  });

  it("works once: the second is told the link was used, and reads nothing", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    expect((await w.redeem(token)).kind).toBe("send");
    const reads = w.state.reads;
    expect((await w.redeem(token)).kind).toBe("used");
    expect(inspectLink(token, w.state.now)).toEqual({ kind: "used" });
    expect(w.state.reads).toBe(reads);
  });

  it("two at once produce one file", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    let sends = 0;
    const send = async () => void (sends += 1);
    const [a, b] = await Promise.all([w.redeem(token, send), w.redeem(token, send)]);
    expect([a.kind, b.kind].sort()).toEqual(["send", "sending"]);
    expect(sends).toBe(1);
  });

  it("is spent once the send starts, even if the send dies", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    await w.redeem(token, async () => {
      throw new Error("socket gone");
    });
    expect(inspectLink(token, w.state.now)).toEqual({ kind: "used" });
    expect(downloadsInFlight()).toBe(0);
  });

  it("sends nothing when the file is no longer the one in the receipt", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    w.state.source = sourceOk(Buffer.from("a different file of another size"));
    const send = vi.fn(async () => {});
    expect((await w.redeem(token, send)).kind).toBe("changed");
    expect(send).not.toHaveBeenCalled();
    expect(inspectLink(token, w.state.now)).toEqual({ kind: "changed" });
  });

  it("catches a change that keeps the size", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    const flipped = Buffer.from(FILE);
    flipped[flipped.length - 3] ^= 1;
    w.state.source = sourceOk(flipped);
    const send = vi.fn(async () => {});
    expect((await w.redeem(token, send)).kind).toBe("changed");
    expect(send).not.toHaveBeenCalled();
  });

  it("expires after ten minutes, is told so while the record is kept, and is not valid after", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    w.state.now += LINK_LIFE_MS - 1;
    expect(inspectLink(token, w.state.now).kind).toBe("live");
    w.state.now += 1;
    expect((await w.redeem(token)).kind).toBe("expired");
    expect(w.state.reads).toBe(1);
    w.state.now += LINK_KEPT_AFTER_MS;
    expect((await w.redeem(token)).kind).toBe("invalid");
    expect(downloadLinksHeld()).toBe(0);
  });

  it("a failed read leaves the link open, however many, and it works once the source answers", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    w.state.source = () => Response.json({ error: "upstream", code: "upstream" }, { status: 502 });
    for (let i = 0; i < 5; i++) {
      expect((await w.redeem(token)).kind).toBe("source");
      expect(inspectLink(token, w.state.now).kind).toBe("live");
    }
    w.state.source = sourceOk();
    expect((await w.redeem(token)).kind).toBe("send");
  });

  it("a source that cannot be reached is a failed read, not a throw", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    w.state.source = () => {
      throw new TypeError("fetch failed");
    };
    expect((await w.redeem(token)).kind).toBe("source");
    expect(downloadsInFlight()).toBe(0);
  });

  it("busy reads nothing and is not a try", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    // The user's one slot is taken by their own running download.
    const other = tokenOf(await w.mint());
    let release!: () => void;
    const running = w.redeem(other, () => new Promise<void>((r) => (release = r)));
    await vi.waitFor(() => expect(downloadsInFlight()).toBe(1));
    const reads = w.state.reads;
    for (let i = 0; i < 4; i++) expect((await w.redeem(token)).kind).toBe("busy");
    expect(w.state.reads).toBe(reads);
    release();
    await running;
    expect((await w.redeem(token)).kind).toBe("send");
  });

  it("reads nothing once the account is disconnected", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    w.state.connected = false;
    const send = vi.fn(async () => {});
    expect((await w.redeem(token, send)).kind).toBe("source");
    expect(send).not.toHaveBeenCalled();
    expect(w.state.reads).toBe(1);
  });

  it("a link does not outlive a restart", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    resetDownloadLinks();
    expect((await w.redeem(token)).kind).toBe("invalid");
  });
});

describe("a link closed while its read is running", () => {
  /** A source that answers only when told to, so something can happen
   * between the claim and the end of the read. */
  function held(w: ReturnType<typeof world>, answer: () => Response) {
    let go!: () => void;
    const gate = new Promise<void>((r) => (go = r));
    w.state.source = async () => (await gate, answer());
    return () => go();
  }
  const ok = () =>
    new Response(new Uint8Array(FILE), {
      status: 200,
      headers: { "Content-Type": "message/rfc822", "X-File-Name": "fixture.eml" },
    });
  const failed = () => Response.json({ error: "upstream", code: "upstream" }, { status: 502 });

  it("sends nothing if it was carried in a tool call meanwhile, and stays cancelled", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    const go = held(w, ok);
    const send = vi.fn(async () => {});
    const running = w.redeem(token, send);
    await vi.waitFor(() => expect(w.state.reads).toBe(2));
    expect(carried("user-1", token, w.state.now)).toBe(true);
    go();
    expect((await running).kind).toBe("cancelled");
    expect(send).not.toHaveBeenCalled();
    expect(inspectLink(token, w.state.now)).toEqual({ kind: "cancelled" });
  });

  it("is not reopened by a failed read after it was cancelled", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    const go = held(w, failed);
    const running = w.redeem(token);
    await vi.waitFor(() => expect(w.state.reads).toBe(2));
    carried("user-1", token, w.state.now);
    go();
    await running;
    expect(inspectLink(token, w.state.now)).toEqual({ kind: "cancelled" });
  });

  it("sends nothing if the user signed out or disconnected meanwhile", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    const go = held(w, ok);
    const send = vi.fn(async () => {});
    const running = w.redeem(token, send);
    await vi.waitFor(() => expect(w.state.reads).toBe(2));
    dropLinksForUser("user-1");
    go();
    expect((await running).kind).toBe("invalid");
    expect(send).not.toHaveBeenCalled();
  });

  it("a read that throws somewhere of ours is a failed read: nothing sent, slot freed, link still open", async () => {
    const w = world();
    const token = tokenOf(await w.mint());
    const working = w.deps.resolvePluginUrl;
    (w.deps as { resolvePluginUrl: unknown }).resolvePluginUrl = async () => {
      throw new Error("db unreachable");
    };
    expect((await w.redeem(token)).kind).toBe("source");
    expect(downloadsInFlight()).toBe(0);
    (w.deps as { resolvePluginUrl: unknown }).resolvePluginUrl = working;
    expect((await w.redeem(token)).kind).toBe("send");
  });
});

describe("when the user's authority changes", () => {
  it("drops that user's links and nobody else's", async () => {
    const w = world();
    const mine = tokenOf(await w.mint("user-1"));
    const theirs = tokenOf(await w.mint("user-2"));
    dropLinksForUser("user-1");
    expect(inspectLink(mine, w.state.now)).toEqual({ kind: "invalid" });
    expect(inspectLink(theirs, w.state.now).kind).toBe("live");
  });
});

describe("the gateway does not carry its own link", () => {
  async function minted() {
    const w = world();
    const result = await w.mint();
    const url = String(receiptOf(result).link.url);
    return { w, url, token: tokenOf(result), nonce: tokenOf(result).split(".")[0] };
  }

  it.each([
    ["the whole link", (l: { url: string }) => l.url],
    ["the token without the path", (l: { token: string }) => l.token],
    ["the nonce alone", (l: { nonce: string }) => l.nonce],
    [
      "percent-encoded, beside a stray percent sign",
      (l: { nonce: string }) => `100% ${[...l.nonce].map((c) => `%${c.charCodeAt(0).toString(16)}`).join("")}`,
    ],
    ["base64", (l: { url: string }) => Buffer.from(`see ${l.url} now`).toString("base64")],
    ["base64url", (l: { url: string }) => Buffer.from(`see ${l.url}`).toString("base64url")],
  ])("refuses and cancels a link carried as %s", async (_label, carry) => {
    const link = await minted();
    const args = JSON.stringify({ to: "x@example.com", body: `here: ${carry(link)}` });
    expect(carried("user-1", args, link.w.state.now)).toBe(true);
    expect(inspectLink(link.token, link.w.state.now)).toEqual({ kind: "cancelled" });
    expect((await link.w.redeem(link.token)).kind).toBe("cancelled");
  });

  it("finds it in base64 wherever it falls, glued to other text of the same alphabet", async () => {
    for (const lead of ["", "x", "xy", "xyz"]) {
      const link = await minted();
      const encoded = Buffer.from(`${lead}${link.token} tail`).toString("base64");
      // Glued to four more characters of the alphabet, so the run does not
      // start where a decoder would start it.
      expect(carried("user-1", `QUJD${encoded}`, link.w.state.now), JSON.stringify(lead)).toBe(true);
      resetDownloadLinks();
    }
  });

  it("does not serialise the arguments at all for a user with no live link", () => {
    const serialise = vi.fn(() => "anything");
    expect(revokeLinksCarriedIn("user-with-none", serialise)).toBe(false);
    expect(serialise).not.toHaveBeenCalled();
  });

  it("searches megabytes of base64 without decoding or failing", async () => {
    const link = await minted();
    const big = Buffer.alloc(9 * 1024 * 1024, 7).toString("base64");
    expect(carried("user-1", JSON.stringify({ attachment: big }), link.w.state.now)).toBe(false);
    expect(carried("user-1", JSON.stringify({ attachment: big, note: link.nonce }), link.w.state.now)).toBe(true);
  });

  it("leaves ordinary arguments, and another user's link, alone", async () => {
    const link = await minted();
    expect(carried("user-1", JSON.stringify({ body: "nothing to see", id: "A".repeat(40) }), link.w.state.now)).toBe(false);
    expect(carried("user-2", JSON.stringify({ body: link.url }), link.w.state.now)).toBe(false);
    expect(inspectLink(link.token, link.w.state.now).kind).toBe("live");
  });

  it("does not claim more than it does: a reversed token passes", async () => {
    const link = await minted();
    const reversed = [...link.url].reverse().join("");
    expect(carried("user-1", JSON.stringify({ body: reversed }), link.w.state.now)).toBe(false);
  });
});

describe("the name a download is saved under", () => {
  it.each([
    ["Quarterly report.eml", "Quarterly report.eml"],
    ["café notes.pdf", "café notes.pdf"],
    [".npmrc", "npmrc"],
    ["...env", "env"],
    ['a"b\'c`d.txt', "abcd.txt"],
    ["../../etc/passwd", "etcpasswd"],
    ["evil‮fdp.exe", "evilfdp.exe"],
    ["line\r\nbreak.txt", "linebreak.txt"],
    ["trailing. . ", "trailing"],
    ["CON", "download"],
    ["nul.txt", "download.txt"],
    ["", "download"],
    ["...", "download"],
  ])("%j becomes %j", (given, expected) => {
    expect(safeDownloadName(given)).toBe(expected);
  });
});

/** SCRUM-428: the type a Drive download goes out with. An export's type is
 * the format the caller chose, so it is ours to send; a stored Drive file's
 * declared type is the uploader's word and stays opaque, as an email
 * attachment's does. */
describe("the type a download is sent with", () => {
  it.each([
    [{ type: "gmail_message", message_id: "m" }, "message/rfc822"],
    [{ type: "gmail_attachment", message_id: "m", part_id: "1" }, "application/octet-stream"],
    [{ type: "drive_file", file_id: "f" }, "application/octet-stream"],
    // A format on a stored file chooses nothing: only an export is typed.
    [{ type: "drive_file", file_id: "f", format: "pdf" }, "application/octet-stream"],
    [{ type: "drive_export", file_id: "f", format: "pdf" }, "application/pdf"],
    [{ type: "drive_export", file_id: "f", format: "xlsx" }, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
    // A page is the one type a browser does something with besides save.
    [{ type: "drive_export", file_id: "f", format: "html" }, "application/octet-stream"],
    [{ type: "drive_export", file_id: "f", format: "constructor" }, "application/octet-stream"],
    [{ type: "constructor" }, "application/octet-stream"],
  ])("%j goes out as %s", (ref, type) => {
    expect(downloadType(ref)).toBe(type);
  });
});
