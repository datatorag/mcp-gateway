/**
 * SCRUM-420: nothing shaped like a download link's token is written to the
 * process's output, whoever writes it.
 *
 * The first half drives real consoles over stand-in streams. The second
 * runs a real process, because an uncaught error is printed by the runtime
 * and no stand-in can show that.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Console } from "node:console";
import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { forgetValue, REDACTED, redactLinkTokens, redactSink, redactValue } from "./log-redaction";
import { createDownloadLink, dropLinksForUser, resetDownloadLinks, DOWNLOAD_PATH } from "./file-download";

const GATEWAY = join(__dirname, "../..");

/** Shaped exactly as a minted token is, and obviously not one. */
const NONCE = "Nn0-nonce_nonce-nonceQ";
const TAG = `${"T".padEnd(42, "tag-_")}9`;
const TOKEN = `${NONCE}.${TAG}`;

/** A real stream, as a console needs, that keeps what reaches it. */
function sink() {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      chunks.push(chunk.toString("utf8"));
      done();
    },
  });
  return Object.assign(stream, { chunks, text: () => chunks.join("") });
}

describe("the shape", () => {
  it("is the shape that is minted", () => {
    expect(NONCE).toHaveLength(22);
    expect(TAG).toHaveLength(43);
  });

  it.each([
    [`GET /files/d/${TOKEN} 404`, `GET /files/d/${REDACTED} 404`],
    [`isn't a valid image for /blog/${TOKEN} received null`, `isn't a valid image for /blog/${REDACTED} received null`],
    [`Failed to decode param 'files%2Fd%2F${TOKEN}%'`, `Failed to decode param 'files%2Fd%2F${REDACTED}%'`],
    [`"${TOKEN}"`, `"${REDACTED}"`],
    [`${TOKEN}.png`, `${REDACTED}.png`],
    [`url=${TOKEN}&w=64`, `url=${REDACTED}&w=64`],
    [`${TOKEN} and ${TOKEN}`, `${REDACTED} and ${REDACTED}`],
    [TOKEN, REDACTED],
  ])("redacts it in %j", (given, expected) => {
    expect(redactLinkTokens(given)).toBe(expected);
  });

  it.each([
    // A SHA-256, a SHA-1, a UUID, a JWT, plain base64, a nonce or a tag alone.
    "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "2fd4e1c67a2d28fced849ee1bb76e7391b93eb12",
    "123e4567-e89b-42d3-a456-426614174000",
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIn0.c2lnbmF0dXJl",
    Buffer.alloc(300, 7).toString("base64"),
    NONCE,
    TAG,
    // One character too long or too short on either side of the dot.
    `${NONCE}x.${TAG}`,
    `${NONCE}.${TAG}x`,
    `${NONCE.slice(1)}.${TAG}`,
    `${NONCE}.${TAG.slice(1)}`,
    "user@example.com wrote file-download.ts:42",
  ])("leaves %j alone", (text) => {
    expect(redactLinkTokens(text)).toBe(text);
  });
});

describe("a live link's halves, by value", () => {
  /** Every way the shape was got around: a neighbour of the alphabet, an
   * encoded or missing dot, a colour code in front. */
  const disguised = (nonce: string, tag: string) => [
    `/blog/x${nonce}.${tag}`,
    `/blog/d${nonce}.${tag}.png`,
    `/blog/-${nonce}.${tag}`,
    `/blog/${nonce}.${tag}png`,
    `/blog/${nonce}.${tag}_`,
    `/blog/${nonce}%2E${tag}`,
    `/blog/${nonce}/${tag}`,
    `/blog/${nonce}..${tag}`,
    `\u001b[31m${nonce}.${tag}`,
    `nonce only ${nonce}`,
    `tag only x${tag}x`,
  ];

  it("the shape alone misses these, which is why there is a second rule", () => {
    expect(disguised(NONCE, TAG).filter((text) => redactLinkTokens(text).includes(NONCE) || redactLinkTokens(text).includes(TAG)).length).toBeGreaterThan(5);
  });

  it("are redacted wherever they appear and whatever touches them, until forgotten", () => {
    redactValue(NONCE);
    redactValue(TAG);
    try {
      for (const text of disguised(NONCE, TAG)) {
        const clean = redactLinkTokens(text);
        expect(clean, text).not.toContain(NONCE);
        expect(clean, text).not.toContain(TAG);
        expect(clean).toContain(REDACTED);
      }
    } finally {
      forgetValue(NONCE);
      forgetValue(TAG);
    }
    expect(redactLinkTokens(`nonce only ${NONCE}`)).toBe(`nonce only ${NONCE}`);
  });

  it("refuses a value short enough to blank ordinary words", () => {
    redactValue("blog");
    expect(redactLinkTokens("/blog/post")).toBe("/blog/post");
  });

  it("a minted link registers both halves, and dropping it forgets them", async () => {
    resetDownloadLinks();
    const result = await createDownloadLink({
      userId: "user-fixture-0001",
      args: { file: { type: "gmail_message", message_id: "message-fixture-0001" } },
      baseUrl: "https://gw.example.test",
      deps: {
        resolveToken: async () => ({ token: "source-token-fixture", accountEmail: "a@example.com", scopes: "https://www.googleapis.com/auth/gmail.modify" }),
        resolvePluginUrl: async () => "http://localhost:40001/mcp",
        surface: "mcp",
        connectionsUrl: "https://gw.example.test/dashboard/connections",
        fetchFn: (async () =>
          new Response(new Uint8Array(Buffer.from("fixture")), {
            status: 200,
            headers: { "Content-Type": "message/rfc822", "X-File-Name": "fixture.eml" },
          })) as unknown as typeof fetch,
      },
    });
    const [nonce, tag] = String(JSON.parse(result.content[0].text!).link.url).split(DOWNLOAD_PATH)[1].split(".");
    for (const text of disguised(nonce, tag)) {
      const clean = redactLinkTokens(text);
      expect(clean, text).not.toContain(nonce);
      expect(clean, text).not.toContain(tag);
    }
    dropLinksForUser("user-fixture-0001");
    // Dead now, and no longer held by value; the bare shape is still caught.
    expect(redactLinkTokens(`x${nonce}`)).toBe(`x${nonce}`);
    expect(redactLinkTokens(`/files/d/${nonce}.${tag}`)).toBe(`/files/d/${REDACTED}`);
  });
});

describe("a wrapped stream", () => {
  it("redacts what console.log and console.error write, for a console made BEFORE the wrap", () => {
    const out = sink();
    const err = sink();
    const early = new Console(out as never, err as never);
    redactSink(out as never);
    redactSink(err as never);
    early.log(`opened /files/d/${TOKEN}`);
    early.error("failed for", { url: `/blog/${TOKEN}` });
    expect(out.text()).toBe(`opened /files/d/${REDACTED}\n`);
    expect(err.text()).toContain(`/blog/${REDACTED}`);
    expect(out.text() + err.text()).not.toContain(NONCE);
  });

  it("redacts a thrown error's message and stack when it is logged", () => {
    const err = sink();
    redactSink(err as never);
    try {
      throw new URIError(`Failed to decode param '${TOKEN}%'`);
    } catch (caught) {
      new Console(err as never, err as never).error(caught);
    }
    expect(err.text()).toContain(REDACTED);
    expect(err.text()).toContain("URIError");
    expect(err.text()).not.toContain(NONCE);
  });

  it("redacts bytes, and passes bytes with nothing in them through untouched", () => {
    const seen: unknown[] = [];
    const out = { write: (chunk: unknown) => (seen.push(chunk), true) };
    redactSink(out as never);
    const clean = Buffer.from("nothing here\n");
    out.write(clean);
    out.write(Buffer.from(`x ${TOKEN}\n`));
    expect(seen[0]).toBe(clean);
    expect(String(seen[1])).toBe(`x ${REDACTED}\n`);
  });

  it("is wrapped once however often it is asked", () => {
    const out = sink();
    redactSink(out as never);
    const once = out.write;
    redactSink(out as never);
    expect(out.write).toBe(once);
  });
});

describe("the server's entry point", () => {
  it("installs the rule as its first import, before the framework or any logger is loaded", () => {
    const source = readFileSync(join(GATEWAY, "server.ts"), "utf8");
    const firstImport = /^import\s.*$/m.exec(source)?.[0];
    expect(firstImport).toBe('import "./src/gateway/log-redaction-install";');
  });
});

describe("a real process with the rule installed", () => {
  const dir = mkdtempSync(join(tmpdir(), "log-redaction-"));
  const run = (body: string) => {
    const file = join(dir, `${Math.random().toString(36).slice(2)}.mts`);
    writeFileSync(file, `import ${JSON.stringify(join(__dirname, "log-redaction-install.ts"))};\n${body}\n`);
    // The loader the dev server itself starts with.
    return spawnSync(process.execPath, ["--import", "tsx/esm", file], { encoding: "utf8", cwd: GATEWAY });
  };

  it("redacts console.log on stdout and console.error on stderr", () => {
    const res = run(`console.log("out ${TOKEN}"); console.error("err ${TOKEN}"); process.stdout.write("raw ${TOKEN}\\n");`);
    expect(res.status).toBe(0);
    expect(res.stdout).toBe(`out ${REDACTED}\nraw ${REDACTED}\n`);
    expect(res.stderr).toBe(`err ${REDACTED}\n`);
  });

  it("redacts an uncaught error, which the runtime would have printed itself, and still exits 1", () => {
    const res = run(`throw new Error("could not read /files/d/${TOKEN}");`);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`could not read /files/d/${REDACTED}`);
    expect(res.stdout + res.stderr).not.toContain(NONCE);
  });

  it("redacts an unhandled rejection the same way", () => {
    const res = run(`Promise.reject(new Error("rejected ${TOKEN}"));`);
    expect(res.status).toBe(1);
    expect(res.stderr).toContain(`rejected ${REDACTED}`);
    expect(res.stdout + res.stderr).not.toContain(NONCE);
  });

  it("does not turn a survivable error into an exit: with another listener it neither prints nor exits", () => {
    const res = run(
      `process.on("uncaughtException", (err) => console.error("theirs:", err.message));
       setTimeout(() => { console.log("still serving"); }, 50);
       throw new Error("survivable ${TOKEN}");`
    );
    expect(res.status).toBe(0);
    expect(res.stdout).toBe("still serving\n");
    // Logged once, by the other listener, and redacted on the way out.
    expect(res.stderr).toBe(`theirs: survivable ${REDACTED}\n`);
  });

  it("the control: without the rule the same process prints the token", () => {
    const file = join(dir, "control.mjs");
    writeFileSync(file, `console.error("err ${TOKEN}");`);
    const res = spawnSync(process.execPath, [file], { encoding: "utf8" });
    expect(res.stderr).toContain(NONCE);
  });
});
