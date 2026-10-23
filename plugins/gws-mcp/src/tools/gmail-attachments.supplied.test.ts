import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { simpleParser, type ParsedMail } from "mailparser";
import { handleGmail } from "./gmail.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import { TOTAL_CAP } from "../attachments/resolve.js";
import { suppliedFrom } from "../internal/consume.js";

/** SCRUM-437: files the gateway hands over with a compose call. An entry of
 * `attachments` that is a file reference arrives as bytes, in its place
 * among the Drive files, and every attachment's report carries its size and
 * SHA-256. Driven through the real handler; the message read back by a real
 * MIME parser. */

const NO_SIG = { data: { sendAs: [{ isDefault: true, signature: "" }] } };
const DRAFT = { data: { id: "d1", message: { id: "dm1", threadId: "t1" } } };
const ID_A = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const ID_DOC = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa987654";
const pdfMeta = { data: { id: ID_A, name: "report.pdf", mimeType: "application/pdf", size: "11" } };
const docMeta = {
  data: { id: ID_DOC, name: "Plan", mimeType: "application/vnd.google-apps.document", webViewLink: `https://docs.google.com/document/d/${ID_DOC}/edit` },
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
const TXT = new TextEncoder().encode("hello from the caller");
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const supplied = (entries: Array<[number, { bytes: Uint8Array; name: string; type: string }]>) => new Map(entries);

async function mailOf(call: Record<string, unknown>): Promise<ParsedMail> {
  return simpleParser(call.bytes as Buffer);
}

describe("an email with files handed over by the gateway", () => {
  it("puts every file in its entry's place, with a receipt per attachment", async () => {
    const { client, calls } = fakeClient([pdfMeta, NO_SIG, { text: "PDF-BYTES-1" }, DRAFT]);
    const res = await handleGmail(
      client,
      "gmail_create_draft",
      { to: "a@example.com", subject: "s", body: "three files", attachments: [{ type: "content" }, ID_A, { type: "drive_file", file_id: "x" }] },
      supplied([
        [0, { bytes: PNG, name: "chart.png", type: "image/png" }],
        [2, { bytes: TXT, name: "notes.txt", type: "text/plain" }],
      ])
    );
    const upload = calls.find((c) => c.upload)!;
    const mail = await mailOf(upload);
    expect(mail.attachments.map((a) => a.filename)).toEqual(["chart.png", "report.pdf", "notes.txt"]);
    expect(new Uint8Array(mail.attachments[0].content)).toEqual(PNG);
    expect(mail.attachments[2].content.toString()).toBe("hello from the caller");
    expect(payload(res).attachments).toEqual([
      { name: "chart.png", mode: "attached", source: "supplied", size: PNG.length, sha256: sha(PNG) },
      { name: "report.pdf", mode: "attached", source: "drive", file_id: ID_A, size: 11, sha256: sha(new TextEncoder().encode("PDF-BYTES-1")) },
      { name: "notes.txt", mode: "attached", source: "supplied", size: TXT.length, sha256: sha(TXT) },
    ]);
  });

  it("places a supplied image inline when the body references its cid", async () => {
    const { client, calls } = fakeClient([NO_SIG, DRAFT]);
    const res = await handleGmail(
      client,
      "gmail_create_draft",
      { to: "a@example.com", subject: "s", html_body: '<p>see <img src="cid:chart.png"></p>', attachments: [{ type: "content" }] },
      supplied([[0, { bytes: PNG, name: "chart.png", type: "image/png" }]])
    );
    const mail = await mailOf(calls.find((c) => c.upload)!);
    expect(mail.attachments[0].contentDisposition).toBe("inline");
    expect(payload(res).attachments[0]).toMatchObject({ name: "chart.png", mode: "inline", cid: "chart.png", source: "supplied" });
  });

  it("counts the supplied files in the 25 MB before any Drive file is read", async () => {
    const big = { data: { ...pdfMeta.data, size: String(3 * 1024 * 1024) } };
    const { client, calls } = fakeClient([big]);
    await expect(
      handleGmail(
        client,
        "gmail_send",
        { to: "a@example.com", subject: "s", body: "x", attachments: [{ type: "content" }, { type: "content" }, ID_A] },
        supplied([
          [0, { bytes: new Uint8Array(20 * 1024 * 1024), name: "a.bin", type: "application/octet-stream" }],
          [1, { bytes: new Uint8Array(3 * 1024 * 1024), name: "b.bin", type: "application/octet-stream" }],
        ])
      )
    ).rejects.toThrow(/over the 25 MB limit/);
    expect(calls.some((c) => c.download || c.upload)).toBe(false);
    expect(TOTAL_CAP).toBe(25 * 1024 * 1024);
  });

  it("refuses a file reference that did not come through the gateway", async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [{ type: "content", name: "a.txt", base64: "aGk=" }] })
    ).rejects.toThrow("attachments[0] is a file reference and has to come through the gateway. Nothing was sent.");
    expect(calls).toHaveLength(0);
  });

  it("gives a Google file sent as a link no size and no hash", async () => {
    const { client } = fakeClient([docMeta, NO_SIG, DRAFT]);
    const res = await handleGmail(
      client,
      "gmail_create_draft",
      { to: "a@example.com", subject: "s", body: "x", attachments: [ID_DOC, { type: "content" }] },
      supplied([[1, { bytes: TXT, name: "notes.txt", type: "text/plain" }]])
    );
    const [link, file] = payload(res).attachments;
    expect(link.mode).toBe("linked");
    expect(link).not.toHaveProperty("sha256");
    expect(link).not.toHaveProperty("size");
    expect(file.sha256).toBe(sha(TXT));
  });
});

describe("the consume route's files, as an email's entries", () => {
  it("maps attachments[i] to entry i", () => {
    const a = { bytes: PNG, name: "a.png", type: "image/png" };
    const b = { bytes: TXT, name: "b.txt", type: "text/plain" };
    const map = suppliedFrom(new Map([["attachments[0]", a], ["attachments[3]", b]]));
    expect(map).toEqual(new Map([[0, a], [3, b]]));
  });

  it("does not take the one-file field for an email", () => {
    expect(suppliedFrom(new Map([["file", { bytes: PNG, name: "a.png", type: "image/png" }]]))).toBeNull();
  });
});
