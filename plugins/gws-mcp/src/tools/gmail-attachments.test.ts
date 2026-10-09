import { describe, expect, it } from "vitest";
import { simpleParser, type ParsedMail } from "mailparser";
import { gmailTools, handleGmail } from "./gmail.js";
import { validateArgs } from "./validate.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import { EXPORTS, TOTAL_CAP } from "../attachments/resolve.js";

/** SCRUM-279: attachments on the five compose tools. These drive the real
 * handler with the argument shapes a caller sends, and read the message the
 * handler actually emitted, parsed by a real MIME parser. */

const NO_SIG = { data: { sendAs: [{ isDefault: true, signature: "" }] } };
const SIG = { data: { sendAs: [{ isDefault: true, signature: "<b>Dana Rivers</b>" }] } };
const SENT = { data: { id: "sent1", threadId: "t1" } };
const DRAFT = { data: { id: "d1", message: { id: "dm1", threadId: "t1" } } };

const ID_A = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
const ID_B = "1ZyXwVuTsRqPoNmLkJiHgFeDcBa987654";

const pdfMeta = (id = ID_A, over: Record<string, unknown> = {}) => ({
  data: { id, name: "report.pdf", mimeType: "application/pdf", size: "11", webViewLink: `https://drive.google.com/file/d/${id}/view`, ...over },
});
const docMeta = (id = ID_B, over: Record<string, unknown> = {}) => ({
  data: {
    id,
    name: "Plan",
    mimeType: "application/vnd.google-apps.document",
    webViewLink: `https://docs.google.com/document/d/${id}/edit`,
    ...over,
  },
});

async function mailOf(call: Record<string, unknown>): Promise<ParsedMail> {
  if (call.upload) return simpleParser(call.bytes as Buffer);
  const body = call.jsonBody as { raw?: string; message?: { raw?: string } };
  return simpleParser(Buffer.from((body.raw ?? body.message?.raw) as string, "base64url"));
}

const methods = (calls: Array<Record<string, unknown>>) =>
  calls.map((c) => `${c.upload ? "upload " : c.download ? "download " : ""}${c.service} ${c.resource}.${c.method}`);

const boundaryFree = (calls: Array<Record<string, unknown>>) =>
  JSON.stringify(calls, (_k, v) => {
    if (typeof v !== "string") return v;
    // The raw carries a random boundary; compare the decoded message with it
    // replaced, so two otherwise identical messages compare equal.
    try {
      const decoded = Buffer.from(v, "base64url").toString("utf8");
      if (decoded.includes("MIME-Version")) return decoded.replace(/=_gws_[0-9a-f-]{36}/g, "B");
    } catch {
      /* not a raw */
    }
    return v;
  });

describe("zero attachments is exactly today's call on every tool", () => {
  const cases: Array<[string, Record<string, unknown>, Array<Record<string, unknown>>]> = [
    ["gmail_send", { to: "a@example.com", subject: "s", body: "hi" }, [NO_SIG, SENT]],
    ["gmail_create_draft", { to: "a@example.com", subject: "s", html_body: "<p>hi</p>" }, [NO_SIG, DRAFT]],
    ["gmail_update_draft", { draft_id: "d1", to: "a@example.com", subject: "s", body: "hi" }, [NO_SIG, { data: { message: { threadId: "t1" } } }, DRAFT]],
  ];
  for (const [tool, args, plan] of cases) {
    it(`${tool}: absent and empty attachments emit the same requests`, async () => {
      const a = fakeClient(structuredClone(plan));
      const b = fakeClient(structuredClone(plan));
      const ra = await handleGmail(a.client, tool, args);
      const rb = await handleGmail(b.client, tool, { ...args, attachments: [] });
      expect(boundaryFree(b.calls)).toBe(boundaryFree(a.calls));
      expect(a.calls.some((c) => c.upload)).toBe(false);
      expect(payload(ra)).not.toHaveProperty("attachments");
      expect(payload(rb)).toEqual(payload(ra));
    });
  }

  const ORIGINAL = {
    data: {
      id: "m1",
      threadId: "t1",
      payload: {
        mimeType: "text/plain",
        headers: [
          { name: "From", value: "S <s@example.com>" },
          { name: "Subject", value: "Orig" },
          { name: "Date", value: "Thu, 1 Jan 2026 00:00:00 +0000" },
          { name: "Message-ID", value: "<o@example.com>" },
        ],
        body: { data: Buffer.from("original").toString("base64url") },
      },
    },
  };
  for (const tool of ["gmail_reply", "gmail_forward"]) {
    it(`${tool}: absent and empty attachments emit the same requests`, async () => {
      const args = { message_id: "m1", to: "b@example.com", body: "note" };
      const a = fakeClient([NO_SIG, structuredClone(ORIGINAL), SENT]);
      const b = fakeClient([NO_SIG, structuredClone(ORIGINAL), SENT]);
      await handleGmail(a.client, tool, args);
      await handleGmail(b.client, tool, { ...args, attachments: [] });
      expect(boundaryFree(b.calls)).toBe(boundaryFree(a.calls));
      expect(a.calls.some((c) => c.upload)).toBe(false);
    });
  }
});

describe("a Drive file", () => {
  it("non-native: metadata, then signature, then its bytes streamed into one rfc822 upload", async () => {
    const { client, calls } = fakeClient([pdfMeta(), NO_SIG, { text: "PDF-BYTES-1" }, SENT]);
    const res = await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "see attached", attachments: [ID_A] });
    expect(methods(calls)).toEqual([
      "drive files.get",
      "gmail users.settings.sendAs.list",
      "download drive files.get",
      "upload gmail users.messages.send",
    ]);
    expect(calls[0].params).toMatchObject({ fileId: ID_A, supportsAllDrives: true });
    expect(calls[3].contentType).toBe("message/rfc822");
    const mail = await mailOf(calls[3]);
    expect(mail.text?.trim()).toBe("see attached");
    expect(mail.attachments).toHaveLength(1);
    expect(mail.attachments[0].filename).toBe("report.pdf");
    expect(mail.attachments[0].contentType).toBe("application/pdf");
    expect(mail.attachments[0].content.toString()).toBe("PDF-BYTES-1");
    expect(payload(res).attachments).toEqual([
      { name: "report.pdf", mode: "attached", source: "drive", file_id: ID_A, size: 11 },
    ]);
  });

  it("native: a link in both parts, no download, and raw MIME rather than an upload", async () => {
    const { client, calls } = fakeClient([docMeta(), NO_SIG, SENT]);
    const res = await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "the plan", attachments: [ID_B] });
    expect(methods(calls)).toEqual(["drive files.get", "gmail users.settings.sendAs.list", "gmail users.messages.send"]);
    const mail = await mailOf(calls[2]);
    const link = `https://docs.google.com/document/d/${ID_B}/edit`;
    expect(mail.text).toContain(`Plan: ${link}`);
    expect(mail.html).toContain(`<a href="${link}">Plan</a>`);
    expect(mail.attachments).toHaveLength(0);
    expect(payload(res).attachments).toEqual([{ name: "Plan", mode: "linked", source: "drive", file_id: ID_B, link }]);
  });

  it("the order is note, links, signature", async () => {
    const { client, calls } = fakeClient([docMeta(), SIG, SENT]);
    await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "the plan", attachments: [ID_B] });
    const html = (await mailOf(calls[2])).html as string;
    const note = html.indexOf("the plan");
    const link = html.indexOf(">Plan</a>");
    const sig = html.indexOf("Dana Rivers");
    expect(note).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(note);
    expect(sig).toBeGreaterThan(link);
    // The plain part carries the link and never the signature.
    const text = (await mailOf(calls[2])).text as string;
    expect(text).toContain("Plan: https://docs.google.com/");
    expect(text).not.toContain("Dana Rivers");
  });

  it("a hostile Drive name is escaped in the link and cannot break a header", async () => {
    const { client, calls } = fakeClient([
      docMeta(ID_B, { name: '<img src=x onerror=alert(1)>' }),
      pdfMeta(ID_A, { name: "x.pdf\r\nBcc: evil@example.com", mimeType: "application/pdf\r\nX: y" }),
      NO_SIG,
      { text: "b" },
      SENT,
    ]);
    await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", html_body: "<p>hi</p>", attachments: [ID_B, ID_A] });
    const call = calls[calls.length - 1];
    const raw = (call.bytes as Buffer).toString("latin1");
    expect(raw).not.toMatch(/\r\nBcc:/i);
    expect(raw).not.toMatch(/\r\nX: y/);
    const mail = await mailOf(call);
    expect(mail.bcc).toBeUndefined();
    expect(mail.html).not.toContain("<img src=x");
    expect(mail.html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(mail.attachments[0].contentType).toBe("application/octet-stream");
  });

  it("a webViewLink that is not an https Google URL is replaced by the canonical Drive link", async () => {
    const { client, calls } = fakeClient([docMeta(ID_B, { webViewLink: "javascript:alert(1)//docs.google.com" }), NO_SIG, SENT]);
    const res = await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [ID_B] });
    const mail = await mailOf(calls[2]);
    expect(mail.html).not.toContain("javascript:");
    expect(payload(res).attachments[0].link).toBe(`https://drive.google.com/open?id=${ID_B}`);
    // Positive control in the same shape: a real Google link is kept.
    const ok = fakeClient([docMeta(ID_B, { webViewLink: "https://docs.google.com/document/d/x/edit" }), NO_SIG, SENT]);
    const okRes = await handleGmail(ok.client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [ID_B] });
    expect(payload(okRes).attachments[0].link).toBe("https://docs.google.com/document/d/x/edit");
  });

  it("as pdf: a Doc goes through files.export and reports exported with the bytes it took", async () => {
    const { client, calls } = fakeClient([docMeta(), NO_SIG, { text: "EXPORTED" }, SENT]);
    const res = await handleGmail(client, "gmail_send", {
      to: "a@example.com",
      subject: "s",
      body: "x",
      attachments: [{ file_id: ID_B, as: "pdf" }],
    });
    const dl = calls.find((c) => c.download) as Record<string, unknown>;
    expect(`${dl.resource}.${dl.method}`).toBe("files.export");
    expect(dl.params).toEqual({ fileId: ID_B, mimeType: "application/pdf" });
    const mail = await mailOf(calls[calls.length - 1]);
    expect(mail.attachments[0].filename).toBe("Plan.pdf");
    expect(mail.attachments[0].contentType).toBe("application/pdf");
    expect(payload(res).attachments).toEqual([
      { name: "Plan.pdf", mode: "exported", source: "drive", file_id: ID_B, size: 8 },
    ]);
  });

  it("as docx on a Doc names the docx type", async () => {
    const { client, calls } = fakeClient([docMeta(), NO_SIG, { text: "D" }, SENT]);
    await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [{ file_id: ID_B, as: "docx" }] });
    const dl = calls.find((c) => c.download) as Record<string, unknown>;
    expect((dl.params as Record<string, unknown>).mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    );
    expect((await mailOf(calls[calls.length - 1])).attachments[0].filename).toBe("Plan.docx");
  });
});

describe("refusals land before any download, and before the signature lookup", () => {
  const refused = async (plan: Array<Record<string, unknown>>, attachments: unknown, match: RegExp, tool = "gmail_send") => {
    const { client, calls } = fakeClient(plan);
    await expect(
      handleGmail(client, tool, { to: "a@example.com", subject: "s", body: "x", attachments })
    ).rejects.toThrow(match);
    expect(calls.some((c) => c.download)).toBe(false);
    expect(calls.some((c) => c.upload)).toBe(false);
    expect(calls.some((c) => c.resource === "spreadsheets.values")).toBe(false);
    expect(calls.some((c) => c.resource === "users.settings.sendAs")).toBe(false);
    expect(calls.some((c) => c.resource === "users.messages" || c.resource === "users.drafts")).toBe(false);
    return calls;
  };

  it("a format the source cannot take, naming the file and both halves of the pair", async () => {
    await refused([docMeta(ID_B, { name: "Budget", mimeType: "application/vnd.google-apps.spreadsheet" })], [{ file_id: ID_B, as: "docx" }], /"Budget": Sheets cannot be exported as docx/);
  });

  it("as on a file that is not a Google Doc", async () => {
    await refused([pdfMeta()], [{ file_id: ID_A, as: "pdf" }], /"report\.pdf" is not a Google Doc/);
  });

  it("a folder", async () => {
    await refused([pdfMeta(ID_A, { name: "Stuff", mimeType: "application/vnd.google-apps.folder" })], [ID_A], /"Stuff" .* is a folder/);
  });

  it("a missing or unshared id, naming the id", async () => {
    await refused([{ throws: "Google API error 404: File not found" }], [ID_A], new RegExp(`Drive file ${ID_A} could not be read`));
  });

  it("an empty metadata answer: no size to check, so refused rather than attached", async () => {
    await refused([{ data: {} }], [ID_A], /has no size/);
  });

  it("over 25 MB in total, naming the file that crosses and the cap; the fetcher is never called", async () => {
    const calls = await refused(
      [pdfMeta(ID_A, { size: String(TOTAL_CAP - 10) }), pdfMeta(ID_B, { name: "big.zip", size: "11" })],
      [ID_A, ID_B],
      /"big\.zip" takes the attachments to .* over the 25 MB limit/
    );
    expect(calls).toHaveLength(2);
  });

  it("exactly at the cap is allowed", async () => {
    const { client } = fakeClient([pdfMeta(ID_A, { size: String(TOTAL_CAP) }), NO_SIG, { text: "x" }, SENT]);
    await expect(handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [ID_A] })).resolves.toBeDefined();
  });

  it("two attachments with one filename, naming it", async () => {
    await refused([pdfMeta(ID_A), pdfMeta(ID_B)], [ID_A, ID_B], /Two attachments are named "report\.pdf"/);
  });

  it("two filenames that would share a Content-ID, naming both", async () => {
    await refused(
      [pdfMeta(ID_A, { name: "a b.pdf" }), pdfMeta(ID_B, { name: "a_b.pdf" })],
      [ID_A, ID_B],
      /"a b\.pdf" and "a_b\.pdf" would share the Content-ID "a_b\.pdf"/
    );
  });

  it("the same Doc exported twice in one format is a duplicate too", async () => {
    await refused([docMeta(), docMeta()], [{ file_id: ID_B, as: "pdf" }, { file_id: ID_B, as: "pdf" }], /Two attachments are named "Plan\.pdf"/);
  });

  it("a positive control: distinct names pass the duplicate check", async () => {
    const { client } = fakeClient([pdfMeta(ID_A), pdfMeta(ID_B, { name: "other.pdf" }), NO_SIG, { text: "a" }, { text: "b" }, SENT]);
    const res = await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [ID_A, ID_B] });
    expect(payload(res).attachments.map((a: { name: string }) => a.name)).toEqual(["report.pdf", "other.pdf"]);
  });

  it("shape errors cost no request at all", async () => {
    for (const [attachments, match] of [
      [Array.from({ length: 11 }, () => ID_A), /at most 10/],
      [["not an id!"], /not a Drive file id/],
      [[{ file_id: ID_A, as: "gif" }], /as must be one of pdf, docx/],
      [[{ file_id: ID_A, as: "pdf", tab: "Sheet1" }], /tab applies only to "as": "csv" or "tsv"/],
      [[{ file_id: ID_A, tab: "Sheet1" }], /tab applies only/],
      [[{ file_id: ID_A, as: "csv", tab: "" }], /tab must be a tab title/],
      ["one-id", /must be an array/],
    ] as Array<[unknown, RegExp]>) {
      const calls = await refused([], attachments, match);
      expect(calls).toHaveLength(0);
    }
  });

  it("bytes in the call are not a source: the entry is refused, pointing at Drive", async () => {
    const png = Buffer.from("89504e47", "hex").toString("base64");
    // The v1 bytes shape gets the message that says where files come from.
    const calls = await refused([], [{ filename: "a.png", mime_type: "image/png", data: png }], /Files are attached from Drive; put the file in Drive and pass its id/);
    expect(calls).toHaveLength(0);
    // Bytes smuggled beside a real id are refused too, not silently dropped.
    await refused([], [{ file_id: ID_A, data: png }], /has "data"; an entry takes file_id, as and tab/);
  });

  it("the same refusals on every tool that takes attachments", async () => {
    for (const tool of ["gmail_create_draft", "gmail_update_draft"]) {
      const { client, calls } = fakeClient([]);
      await expect(
        handleGmail(client, tool, { draft_id: "d1", to: "a@example.com", subject: "s", body: "x", attachments: ["bad id!"] })
      ).rejects.toThrow(/not a Drive file id/);
      expect(calls).toHaveLength(0);
    }
    for (const tool of ["gmail_reply", "gmail_forward"]) {
      const { client, calls } = fakeClient([]);
      await expect(
        handleGmail(client, tool, { message_id: "m1", to: "b@example.com", body: "x", attachments: ["bad id!"] })
      ).rejects.toThrow(/not a Drive file id/);
      expect(calls).toHaveLength(0);
    }
  });
});

describe("the export table, per source", () => {
  const SHEET = "application/vnd.google-apps.spreadsheet";
  const cases: Array<[string, string, string[], string]> = [
    ["Docs", "application/vnd.google-apps.document", ["pdf", "docx", "txt", "html", "md", "rtf", "odt", "epub"], "xlsx"],
    ["Sheets", SHEET, ["pdf", "xlsx", "csv", "tsv", "html", "ods"], "docx"],
    ["Slides", "application/vnd.google-apps.presentation", ["pdf", "pptx", "txt", "odp"], "csv"],
  ];

  for (const [label, type, formats, rejected] of cases) {
    it(`${label}: accepts exactly ${formats.join(", ")}, and refuses ${rejected} naming both`, async () => {
      expect(Object.keys(EXPORTS[type].formats)).toEqual(formats);
      for (const as of formats) {
        const tabbed = as === "csv" || as === "tsv";
        const plan = [
          docMeta(ID_B, { name: "Thing", mimeType: type }),
          ...(tabbed ? [{ data: { sheets: [{ properties: { title: "Sheet1" } }] } }] : []),
          NO_SIG,
          tabbed ? { data: { values: [["a"]] } } : { text: "BYTES" },
          SENT,
        ];
        const { client, calls } = fakeClient(plan);
        const res = await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [{ file_id: ID_B, as }] });
        const format = EXPORTS[type].formats[as];
        const mail = await mailOf(calls[calls.length - 1]);
        expect(mail.attachments).toHaveLength(1);
        expect(String(mail.attachments[0].filename).endsWith(format.ext)).toBe(true);
        expect(mail.attachments[0].contentType).toBe(format.mimeType);
        expect(payload(res).attachments[0].mode).toBe("exported");
        if (!tabbed) {
          const dl = calls.find((c) => c.download) as Record<string, unknown>;
          expect(`${dl.resource}.${dl.method}`).toBe("files.export");
          expect((dl.params as Record<string, unknown>).mimeType).toBe(format.exportAs);
        }
      }
      const { client, calls } = fakeClient([docMeta(ID_B, { name: "Thing", mimeType: type })]);
      await expect(
        handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [{ file_id: ID_B, as: rejected }] })
      ).rejects.toThrow(`"Thing": ${label} cannot be exported as ${rejected}`);
      expect(calls).toHaveLength(1);
    });
  }

  it("a Sheet as html is attached as a .zip, a Slides deck as txt as .txt", async () => {
    expect(EXPORTS[SHEET].formats.html).toMatchObject({ exportAs: "application/zip", mimeType: "application/zip", ext: ".zip" });
    expect(EXPORTS["application/vnd.google-apps.presentation"].formats.txt).toMatchObject({ exportAs: "text/plain", ext: ".txt" });
  });

  const TABS = { data: { sheets: [{ properties: { title: "Sheet1" } }, { properties: { title: "Q3 'final'" } }, { properties: { title: "Notes" } }] } };

  it("csv with no tab: the first tab goes, and the response says which of how many", async () => {
    const values = { data: { values: [["name", "note"], ["Ann", 'said "hi", then left'], ["Bo", "two\nlines"], ["Cy"]] } };
    const { client, calls } = fakeClient([docMeta(ID_B, { name: "Budget", mimeType: SHEET }), TABS, NO_SIG, values, SENT]);
    const res = await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [{ file_id: ID_B, as: "csv" }] });
    const read = calls.find((c) => c.resource === "spreadsheets.values") as Record<string, unknown>;
    expect(read.params).toMatchObject({ spreadsheetId: ID_B, range: "'Sheet1'", valueRenderOption: "FORMATTED_VALUE" });
    const mail = await mailOf(calls[calls.length - 1]);
    expect(mail.attachments[0].filename).toBe("Budget - Sheet1.csv");
    expect(mail.attachments[0].content.toString()).toBe('name,note\r\nAnn,"said ""hi"", then left"\r\nBo,"two\nlines"\r\nCy\r\n');
    expect(payload(res).attachments[0]).toMatchObject({ name: "Budget - Sheet1.csv", mode: "exported", note: "exported tab Sheet1 of 3" });
  });

  it("tsv of a named tab: the title is quoted for A1 with its quotes doubled, and tabs in a cell become spaces", async () => {
    const values = { data: { values: [["a\tb", "c"]] } };
    const { client, calls } = fakeClient([docMeta(ID_B, { name: "Budget", mimeType: SHEET }), TABS, NO_SIG, values, SENT]);
    const res = await handleGmail(client, "gmail_send", {
      to: "a@example.com",
      subject: "s",
      body: "x",
      attachments: [{ file_id: ID_B, as: "tsv", tab: "Q3 'final'" }],
    });
    const read = calls.find((c) => c.resource === "spreadsheets.values") as Record<string, unknown>;
    expect((read.params as Record<string, unknown>).range).toBe("'Q3 ''final'''");
    const mail = await mailOf(calls[calls.length - 1]);
    expect(mail.attachments[0].content.toString()).toBe("a b\tc\r\n");
    expect(payload(res).attachments[0].note).toBe("exported tab Q3 'final' of 3");
  });

  it("an unknown tab is refused before any value is read, listing the tabs", async () => {
    const { client, calls } = fakeClient([docMeta(ID_B, { name: "Budget", mimeType: SHEET }), TABS]);
    await expect(
      handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [{ file_id: ID_B, as: "csv", tab: "Q4" }] })
    ).rejects.toThrow(/"Budget" has no tab "Q4"; its tabs are "Sheet1", "Q3 'final'", "Notes"/);
    expect(calls.map((c) => c.resource)).toEqual(["files", "spreadsheets"]);
  });
});

describe("inline images by cid", () => {
  const png = Buffer.from("89504e470d0a1a0a0000", "hex");
  const pngMeta = (id: string, name: string) => pdfMeta(id, { name, mimeType: "image/png", size: String(png.length) });

  it("a Drive image referenced by cid goes inline in multipart/related; one not referenced is attached", async () => {
    const { client, calls } = fakeClient([pngMeta(ID_A, "chart.png"), pdfMeta(ID_B, { name: "notes.pdf" }), NO_SIG, { bytes: png }, { text: "PDF" }, SENT]);
    const res = await handleGmail(client, "gmail_send", {
      to: "a@example.com",
      subject: "s",
      html_body: '<p>chart:</p><img src="cid:chart.png">',
      attachments: [ID_A, ID_B],
    });
    const call = calls[calls.length - 1];
    const raw = (call.bytes as Buffer).toString("latin1");
    expect(raw).toMatch(/multipart\/mixed/);
    expect(raw).toMatch(/multipart\/related/);
    const mail = await mailOf(call);
    const byName = Object.fromEntries(mail.attachments.map((a) => [a.filename, a]));
    expect(byName["chart.png"].contentDisposition).toBe("inline");
    expect(byName["chart.png"].cid).toBe("chart.png");
    expect(byName["chart.png"].content.equals(png)).toBe(true);
    expect(byName["notes.pdf"].contentDisposition).toBe("attachment");
    expect(mail.attachments).toHaveLength(2);
    expect(payload(res).attachments).toEqual([
      { name: "chart.png", mode: "inline", source: "drive", file_id: ID_A, size: png.length, cid: "chart.png" },
      { name: "notes.pdf", mode: "attached", source: "drive", file_id: ID_B, size: 3 },
    ]);
  });

  it("inline only: no multipart/mixed at all", async () => {
    const { client, calls } = fakeClient([pngMeta(ID_A, "chart.png"), NO_SIG, { bytes: png }, DRAFT]);
    await handleGmail(client, "gmail_create_draft", {
      to: "a@example.com",
      subject: "s",
      html_body: '<img src="cid:chart.png">',
      attachments: [ID_A],
    });
    const up = calls[calls.length - 1];
    expect(`${up.resource}.${up.method}`).toBe("users.drafts.create");
    const raw = (up.bytes as Buffer).toString("latin1");
    expect(raw).not.toMatch(/multipart\/mixed/);
    expect(raw).toMatch(/multipart\/related/);
  });

  it("attached only: no multipart/related", async () => {
    const { client, calls } = fakeClient([pngMeta(ID_A, "chart.png"), NO_SIG, { bytes: png }, SENT]);
    await handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", html_body: "<p>no image reference</p>", attachments: [ID_A] });
    const raw = (calls[calls.length - 1].bytes as Buffer).toString("latin1");
    expect(raw).toMatch(/multipart\/mixed/);
    expect(raw).not.toMatch(/multipart\/related/);
  });

  it("a name with spaces gets the documented cid, and a near-miss reference does not count", async () => {
    const { client, calls } = fakeClient([pngMeta(ID_A, "my chart.png"), pngMeta(ID_B, "logo.png"), NO_SIG, { bytes: png }, { bytes: png }, SENT]);
    await handleGmail(client, "gmail_send", {
      to: "a@example.com",
      subject: "s",
      // logo.png's cid is a prefix of the only logo reference, which names a
      // different file; that must not pull logo.png inline.
      html_body: '<img src="cid:my_chart.png"><img src="cid:logo.png2">',
      attachments: [ID_A, ID_B],
    });
    const mail = await mailOf(calls[calls.length - 1]);
    const byName = Object.fromEntries(mail.attachments.map((a) => [a.filename, a.contentDisposition]));
    expect(byName).toEqual({ "my chart.png": "inline", "logo.png": "attachment" });
  });
});

describe("reply, forward and the draft tools", () => {
  const ORIGINAL_WITH_FILES = {
    data: {
      id: "m1",
      threadId: "t1",
      payload: {
        mimeType: "multipart/mixed",
        headers: [
          { name: "From", value: "S <s@example.com>" },
          { name: "Subject", value: "Orig" },
          { name: "Date", value: "Thu, 1 Jan 2026 00:00:00 +0000" },
          { name: "Message-ID", value: "<o@example.com>" },
        ],
        parts: [
          {
            mimeType: "multipart/related",
            parts: [
              { mimeType: "text/html", body: { data: Buffer.from('<p>orig</p><img src="cid:logo@x">').toString("base64url") } },
              {
                mimeType: "image/png",
                filename: "logo.png",
                headers: [{ name: "Content-ID", value: "<logo@x>" }],
                body: { attachmentId: "att-logo", size: 4 },
              },
            ],
          },
          { mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "att-inv", size: 7 } },
        ],
      },
    },
  };
  const gmailAttachment = (bytes: string) => ({ text: JSON.stringify({ size: bytes.length, data: Buffer.from(bytes).toString("base64url") }) });

  it("forward carries the original's files; its inline image stays inline under the original Content-ID", async () => {
    const { client, calls } = fakeClient([NO_SIG, ORIGINAL_WITH_FILES, gmailAttachment("LOGO"), gmailAttachment("INVOICE"), SENT]);
    const res = await handleGmail(client, "gmail_forward", { message_id: "m1", to: "b@example.com", body: "fyi" });
    const downloads = calls.filter((c) => c.download).map((c) => (c.params as Record<string, unknown>).id);
    expect(downloads).toEqual(["att-logo", "att-inv"]);
    const mail = await mailOf(calls[calls.length - 1]);
    const byName = Object.fromEntries(mail.attachments.map((a) => [a.filename, a]));
    expect(byName["logo.png"].contentDisposition).toBe("inline");
    expect(byName["logo.png"].cid).toBe("logo@x");
    expect(byName["logo.png"].content.toString()).toBe("LOGO");
    expect(byName["invoice.pdf"].contentDisposition).toBe("attachment");
    expect(byName["invoice.pdf"].content.toString()).toBe("INVOICE");
    expect(payload(res).attachments.map((a: { name: string; mode: string; source: string }) => [a.name, a.mode, a.source])).toEqual([
      ["logo.png", "inline", "original"],
      ["invoice.pdf", "attached", "original"],
    ]);
  });

  it("an inbound Content-ID that could break its header is replaced by one derived from the filename", async () => {
    const hostile = structuredClone(ORIGINAL_WITH_FILES);
    const logo = (hostile.data.payload.parts[0] as { parts: Array<{ headers?: Array<{ name: string; value: string }> }> }).parts[1];
    logo.headers = [{ name: "Content-ID", value: "<a>\r\nBcc: evil@example.com" }];
    const { client, calls } = fakeClient([NO_SIG, hostile, gmailAttachment("LOGO"), gmailAttachment("INVOICE"), SENT]);
    await handleGmail(client, "gmail_forward", { message_id: "m1", to: "b@example.com", body: "fyi" });
    const raw = (calls[calls.length - 1].bytes as Buffer).toString("latin1");
    expect(raw).not.toMatch(/\r\nBcc:/i);
    expect(raw).toContain("Content-ID: <logo.png>");
  });

  it("originals that share a filename are still forwarded: the ruling on duplicates is for the caller's files", async () => {
    const twin = structuredClone(ORIGINAL_WITH_FILES);
    twin.data.payload.parts.push({ mimeType: "application/pdf", filename: "invoice.pdf", body: { attachmentId: "att-inv2", size: 3 } });
    const { client, calls } = fakeClient([NO_SIG, twin, gmailAttachment("LOGO"), gmailAttachment("INVOICE"), gmailAttachment("TWO"), SENT]);
    await handleGmail(client, "gmail_forward", { message_id: "m1", to: "b@example.com", body: "fyi" });
    const mail = await mailOf(calls[calls.length - 1]);
    const invoices = mail.attachments.filter((a) => a.filename === "invoice.pdf");
    expect(invoices.map((a) => a.content.toString())).toEqual(["INVOICE", "TWO"]);
    expect(new Set(invoices.map((a) => a.cid)).size).toBe(2);
  });

  it("forward with include_original_attachments false sends the text alone, as before", async () => {
    const { client, calls } = fakeClient([NO_SIG, ORIGINAL_WITH_FILES, SENT]);
    const res = await handleGmail(client, "gmail_forward", { message_id: "m1", to: "b@example.com", body: "fyi", include_original_attachments: false });
    expect(calls.some((c) => c.download || c.upload)).toBe(false);
    expect(payload(res)).not.toHaveProperty("attachments");
  });

  it("forward refuses originals over the cap before fetching any of them", async () => {
    const big = structuredClone(ORIGINAL_WITH_FILES);
    (big.data.payload.parts[1] as { body: { size: number } }).body.size = TOTAL_CAP;
    const { client, calls } = fakeClient([NO_SIG, big]);
    await expect(handleGmail(client, "gmail_forward", { message_id: "m1", to: "b@example.com", body: "fyi" })).rejects.toThrow(
      /"invoice\.pdf" takes the attachments to .* over the 25 MB limit/
    );
    expect(calls.some((c) => c.download || c.upload)).toBe(false);
  });

  it("forward with Drive ids reads the metadata and the original together, then signs", async () => {
    // The original's fetch is issued first and the metadata beside it; the
    // signature waits for both.
    const { client, calls } = fakeClient([ORIGINAL_WITH_FILES, pdfMeta(), NO_SIG, gmailAttachment("LOGO"), { text: "PDF" }, gmailAttachment("INVOICE"), SENT]);
    await handleGmail(client, "gmail_forward", { message_id: "m1", to: "b@example.com", body: "fyi", attachments: [ID_A] });
    expect(methods(calls).slice(0, 3)).toEqual(["gmail users.messages.get", "drive files.get", "gmail users.settings.sendAs.list"]);
    const mail = await mailOf(calls[calls.length - 1]);
    expect(mail.attachments.map((a) => a.filename).sort()).toEqual(["invoice.pdf", "logo.png", "report.pdf"]);
  });

  it("reply with a file stays in the thread: threadId in the upload metadata, In-Reply-To in the message", async () => {
    const { client, calls } = fakeClient([pdfMeta(), ORIGINAL_WITH_FILES, NO_SIG, { text: "PDF" }, SENT]);
    await handleGmail(client, "gmail_reply", { message_id: "m1", body: "here it is", attachments: [ID_A] });
    const up = calls[calls.length - 1];
    expect(up.upload).toBe(true);
    expect(up.metadata).toEqual({ threadId: "t1" });
    const mail = await mailOf(up);
    expect(mail.inReplyTo).toBe("<o@example.com>");
    // A reply does not carry the original's files.
    expect(mail.attachments.map((a) => a.filename)).toEqual(["report.pdf"]);
  });

  it("update_draft with a file keeps the draft's thread", async () => {
    const { client, calls } = fakeClient([pdfMeta(), { data: { message: { threadId: "t9" } } }, NO_SIG, { text: "PDF" }, DRAFT]);
    await handleGmail(client, "gmail_update_draft", { draft_id: "d1", to: "a@example.com", subject: "s", body: "x", attachments: [ID_A] });
    const up = calls[calls.length - 1];
    expect(`${up.resource}.${up.method}`).toBe("users.drafts.update");
    expect(up.params).toEqual({ userId: "me", id: "d1" });
    expect(up.metadata).toEqual({ message: { threadId: "t9" } });
  });

  it("update_draft with links only keeps the thread on the raw path", async () => {
    const { client, calls } = fakeClient([docMeta(), { data: { message: { threadId: "t9" } } }, NO_SIG, DRAFT]);
    await handleGmail(client, "gmail_update_draft", { draft_id: "d1", to: "a@example.com", subject: "s", body: "x", attachments: [ID_B] });
    const last = calls[calls.length - 1];
    expect(last.upload).toBeUndefined();
    expect((last.jsonBody as { message: { threadId: string } }).message.threadId).toBe("t9");
  });
});

describe("the running budget", () => {
  it("an export that turns out larger than the cap stops the stream, so the upload never finishes", async () => {
    const huge = Buffer.alloc(TOTAL_CAP + 1, 0x41);
    const { client, calls } = fakeClient([docMeta(), NO_SIG, { bytes: huge }, SENT]);
    await expect(
      handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [{ file_id: ID_B, as: "pdf" }] })
    ).rejects.toThrow(/over the 25 MB limit: "Plan\.pdf" took the total past it/);
    expect(calls.some((c) => c.upload)).toBe(false);
  });

  it("a download that fails names the file", async () => {
    const { client } = fakeClient([pdfMeta(), NO_SIG, { throws: "Google API error 403: rate" }]);
    await expect(
      handleGmail(client, "gmail_send", { to: "a@example.com", subject: "s", body: "x", attachments: [ID_A] })
    ).rejects.toThrow(/Could not read attachment "report\.pdf": Google API error 403/);
  });
});

describe("through the real argument boundary", () => {
  it("a double-encoded attachments array is unwrapped by the validator and then attached", async () => {
    const tool = gmailTools.find((t) => t.name === "gmail_send")!;
    const args: Record<string, unknown> = {
      to: "a@example.com",
      subject: "s",
      body: "x",
      attachments: JSON.stringify([ID_A]),
      include_original_attachments: undefined,
    };
    delete args.include_original_attachments;
    validateArgs(tool, args);
    const { client, calls } = fakeClient([pdfMeta(), NO_SIG, { text: "PDF" }, SENT]);
    await handleGmail(client, "gmail_send", args);
    expect(calls[calls.length - 1].upload).toBe(true);
  });

  it("every tool that takes attachments advertises it, and include_original_attachments only on forward", () => {
    const withAttachments = gmailTools.filter((t) => "attachments" in (t.inputSchema.properties as object)).map((t) => t.name).sort();
    expect(withAttachments).toEqual(["gmail_create_draft", "gmail_forward", "gmail_reply", "gmail_send", "gmail_update_draft"]);
    const withCarry = gmailTools.filter((t) => "include_original_attachments" in (t.inputSchema.properties as object)).map((t) => t.name);
    expect(withCarry).toEqual(["gmail_forward"]);
  });
});
