import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MockAgent, getGlobalDispatcher, setGlobalDispatcher, type Dispatcher } from "undici";
import { simpleParser } from "mailparser";
import { GwsClient } from "../gws-client.js";
import { handleGmail } from "./gmail.js";
import { RESUMABLE_THRESHOLD } from "../google-api/direct-upload.js";

/**
 * A message with a file over the resumable threshold, end to end through the
 * real client and Node's real fetch (SCRUM-279). The global dispatcher is an
 * undici MockAgent answering as Google does, so the transport's redirect
 * handling, the resumable session and its 308s all run as in production,
 * with no network.
 */

const TOKEN = "ya29.SECRET-bearer-attachments-fetch";
const DRIVE = "https://www.googleapis.com";
const GMAIL = "https://gmail.googleapis.com";
const FILE_ID = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";

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

describe("a large attachment through the real transport", () => {
  it("a Drive file over the resumable threshold arrives whole in a message sent by resumable upload", async () => {
    const size = RESUMABLE_THRESHOLD + 1024 * 1024 + 7;
    const file = Buffer.alloc(size);
    for (let i = 0; i < size; i++) file[i] = (i * 31) % 256;

    const drive = agent.get(DRIVE);
    drive
      .intercept({ path: (p) => p.startsWith(`/drive/v3/files/${FILE_ID}?`) && !p.includes("alt=media"), method: "GET" })
      .reply(200, { id: FILE_ID, name: "video.mp4", mimeType: "video/mp4", size: String(size) });
    drive
      .intercept({ path: (p) => p.startsWith(`/drive/v3/files/${FILE_ID}?`) && p.includes("alt=media"), method: "GET" })
      .reply(200, file, { headers: { "content-length": String(size) } });

    const gmail = agent.get(GMAIL);
    gmail
      .intercept({ path: (p) => p.startsWith("/gmail/v1/users/me/settings/sendAs"), method: "GET" })
      .reply(200, { sendAs: [{ isDefault: true, signature: "" }] });

    const session = "/upload/gmail/v1/users/me/messages/send?uploadType=resumable&upload_id=s1";
    let opened: { contentType?: string; body?: string } = {};
    gmail
      // Google takes a resumable session at either path; the client opens it
      // at /upload/...?uploadType=resumable for a templated method path.
      .intercept({
        path: (p) =>
          /^\/(resumable\/)?upload\/gmail\/v1\/users\/me\/messages\/send\?/.test(p) && p.includes("uploadType=resumable"),
        method: "POST",
      })
      .reply((req) => {
        const headers = req.headers as Record<string, string>;
        opened = { contentType: headers["x-upload-content-type"] ?? headers["X-Upload-Content-Type"], body: String(req.body) };
        return { statusCode: 200, data: "", responseOptions: { headers: { location: `${GMAIL}${session}` } } };
      });
    const received: Buffer[] = [];
    let sent = 0;
    const header = (req: { headers?: unknown }, name: string): string | undefined => {
      const h = req.headers as Record<string, string> | string[] | undefined;
      if (Array.isArray(h)) {
        for (let i = 0; i < h.length; i += 2) if (h[i].toLowerCase() === name) return h[i + 1];
        return undefined;
      }
      return Object.entries(h ?? {}).find(([k]) => k.toLowerCase() === name)?.[1];
    };
    gmail
      .intercept({ path: session, method: "PUT" })
      .reply((req) => {
        const chunk = Buffer.from(req.body as Uint8Array);
        received.push(chunk);
        sent += chunk.length;
        // Every chunk but the last says "/*"; the last names the total.
        const range = header(req, "content-range") ?? "";
        if (!range.endsWith("/*")) return { statusCode: 200, data: JSON.stringify({ id: "sent1", threadId: "t1" }) };
        return { statusCode: 308, data: "", responseOptions: { headers: { range: `bytes=0-${sent - 1}` } } };
      })
      .persist();

    const client = new GwsClient({ accessToken: TOKEN });
    const res = await handleGmail(client, "gmail_send", {
      to: "reader@example.com",
      subject: "[smoke] big",
      body: "the file",
      attachments: [FILE_ID],
    });
    expect(JSON.parse(res.content[0].text).attachments).toEqual([
      { name: "video.mp4", mode: "attached", source: "drive", file_id: FILE_ID, size },
    ]);
    // More than one chunk, so the 308 path ran.
    expect(received.length).toBeGreaterThan(1);
    expect(opened.contentType).toBe("message/rfc822");
    const message = Buffer.concat(received);
    expect(message.length).toBeGreaterThan(size);
    const mail = await simpleParser(message);
    expect(mail.subject).toBe("[smoke] big");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].filename).toBe("video.mp4");
    expect(mail.attachments[0].content.equals(file)).toBe(true);
  });
});
