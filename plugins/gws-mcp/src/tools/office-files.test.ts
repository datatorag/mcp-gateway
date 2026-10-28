import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createMcpServer } from "../create-server.js";
import { GwsClient } from "../gws-client.js";
import { retryClock } from "../google-api/rate-limit-retry.js";
import { GOOGLE_DOC, GOOGLE_SHEET, GOOGLE_SLIDES, googleTypeFor } from "./office-files.js";

/* SCRUM-455: an Office file in Drive given to a Sheets, Docs or Slides tool,
 * and the convert option on drive_copy_file. Through the MCP server the way
 * the gateway calls it, against a stubbed fetch that answers what Google
 * answers, so the request the plugin sends is what is asserted. */

const TOKEN = "fixture-bearer-not-a-real-token";
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const DOCX = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const OFFICE_400 = () =>
  json(
    {
      error: {
        code: 400,
        message: "This operation is not supported for this document. The document must not be an Office file.",
        status: "FAILED_PRECONDITION",
      },
    },
    400
  );

type Sent = { url: URL; method: string; body: unknown };

/** Google answers by route; every request is recorded. */
function google(routes: { drive?: (s: Sent) => Response; api: (s: Sent) => Response }) {
  const sent: Sent[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const s = { url: new URL(String(input)), method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : undefined };
    sent.push(s);
    if (s.url.pathname.startsWith("/drive/") && routes.drive) return routes.drive(s);
    return routes.api(s);
  });
  return sent;
}

async function call(name: string, args: Record<string, unknown>) {
  const server = createMcpServer(new GwsClient({ accessToken: TOKEN }));
  const [a, b] = InMemoryTransport.createLinkedPair();
  const mcp = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), mcp.connect(b)]);
  return (await mcp.callTool({ name, arguments: args })) as { isError?: boolean; content: Array<{ text: string }> };
}

beforeEach(() => {
  vi.spyOn(retryClock, "sleep").mockResolvedValue();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("an Office file given to a Google tool (SCRUM-455)", () => {
  it("an Excel file on a Sheets tool says so and names the conversion", async () => {
    const sent = google({ api: OFFICE_400, drive: () => json({ mimeType: XLSX }) });
    const res = await call("sheets_get_metadata", { spreadsheet_id: "xlsxFile" });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toBe(
      "This file is an Excel file, not a Google Sheet, so sheets_get_metadata cannot open it. " +
        "drive_copy_file with convert set to true copies it as a Google Sheet; use that copy's file id here."
    );
    const lookup = sent.find((s) => s.url.pathname.includes("/drive/"));
    expect(lookup?.url.pathname).toMatch(/\/files\/xlsxFile$/);
    expect(lookup?.url.searchParams.get("fields")).toBe("mimeType");
  });

  it("a Word file on a Sheets tool names the tools that open its converted copy", async () => {
    google({ api: OFFICE_400, drive: () => json({ mimeType: DOCX }) });
    const res = await call("sheets_read", { spreadsheet_id: "docxFile", range: "A1:B2" });
    expect(res.content[0].text).toBe(
      "This file is a Word file, not a Google Sheet, so sheets_read cannot open it. " +
        "drive_copy_file with convert set to true copies it as a Google Doc; the docs_ tools open that copy."
    );
  });

  it("a Word file on a Docs tool is covered by the same check", async () => {
    google({ api: OFFICE_400, drive: () => json({ mimeType: DOCX }) });
    const res = await call("docs_get", { document_id: "docxFile" });
    expect(res.content[0].text).toMatch(/^This file is a Word file, not a Google Doc, so docs_get cannot open it\./);
  });

  it("an ordinary 400 (INVALID_ARGUMENT) keeps Google's own error and asks Drive nothing", async () => {
    const sent = google({
      api: () => json({ error: { code: 400, message: "Unable to parse range: Nope!A1", status: "INVALID_ARGUMENT" } }, 400),
      drive: () => json({ mimeType: GOOGLE_SHEET }),
    });
    const res = await call("sheets_read", { spreadsheet_id: "realSheet", range: "Nope!A1" });
    expect(res.content[0].text).toMatch(/^Error: API error: .*Unable to parse range/);
    expect(sent.some((s) => s.url.pathname.startsWith("/drive/"))).toBe(false);
  });

  it("a 400 with no reason still asks Drive, and keeps Google's error for a Google file", async () => {
    const sent = google({
      api: () => new Response("<html>bad request</html>", { status: 400 }),
      drive: () => json({ mimeType: GOOGLE_SHEET }),
    });
    const res = await call("sheets_get_metadata", { spreadsheet_id: "realSheet" });
    expect(res.content[0].text).toMatch(/^Error: /);
    expect(sent.some((s) => s.url.pathname.startsWith("/drive/"))).toBe(true);
  });

  it("gws_run against the Sheets API on an Excel file is covered too", async () => {
    google({ api: OFFICE_400, drive: () => json({ mimeType: XLSX }) });
    const res = await call("gws_run", {
      service: "sheets",
      resource: "spreadsheets",
      method: "get",
      params: { spreadsheetId: "xlsxFile" },
    });
    expect(res.content[0].text).toMatch(/^This file is an Excel file, not a Google Sheet, so gws_run cannot open it\./);
  });

  it("an error that is not a 400 asks Drive nothing", async () => {
    const sent = google({ api: () => json({ error: { code: 404, message: "not found", status: "NOT_FOUND" } }, 404) });
    const res = await call("sheets_get_metadata", { spreadsheet_id: "gone" });
    expect(res.content[0].text).toMatch(/^Error: /);
    expect(sent.some((s) => s.url.pathname.startsWith("/drive/"))).toBe(false);
  });

  it("a Drive lookup that fails keeps Google's own error", async () => {
    google({ api: OFFICE_400, drive: () => json({ error: { code: 404, message: "no" } }, 404) });
    const res = await call("sheets_get_metadata", { spreadsheet_id: "xlsxFile" });
    expect(res.content[0].text).toMatch(/must not be an Office file/);
  });
});

describe("drive_copy_file with convert (SCRUM-455)", () => {
  it("copies an Excel file as a Google Sheet and returns what the copy became", async () => {
    const sent = google({
      api: () => json({}),
      drive: (s) =>
        s.method === "POST"
          ? json({ id: "new-sheet", name: "Budget", mimeType: GOOGLE_SHEET, parents: ["p"], webViewLink: "https://docs.google.com/x" })
          : json({ mimeType: XLSX }),
    });
    const res = await call("drive_copy_file", { file_id: "xlsxFile", name: "Budget", convert: true });
    expect(res.isError).toBeFalsy();
    expect(JSON.parse(res.content[0].text)).toMatchObject({ id: "new-sheet", mimeType: GOOGLE_SHEET });
    const copy = sent.find((s) => s.method === "POST")!;
    expect(copy.url.pathname).toMatch(/\/files\/xlsxFile\/copy$/);
    expect(copy.body).toEqual({ name: "Budget", mimeType: GOOGLE_SHEET });
    expect(copy.url.searchParams.get("fields")).toBe("id,name,mimeType,parents,webViewLink");
  });

  it("refuses a file that is not an Office file, and copies nothing", async () => {
    const sent = google({ api: () => json({}), drive: () => json({ mimeType: "application/pdf" }) });
    const res = await call("drive_copy_file", { file_id: "pdfFile", name: "x", convert: true });
    expect(res.isError).toBe(true);
    expect(res.content[0].text).toMatch(/this file is of another type, so nothing was copied/);
    expect(res.content[0].text).not.toContain("application/pdf");
    expect(sent.some((s) => s.method === "POST")).toBe(false);
  });

  it("without convert, a copy is a copy: no type lookup and no mimeType", async () => {
    const sent = google({ api: () => json({}), drive: () => json({ id: "c", name: "x" }) });
    await call("drive_copy_file", { file_id: "any", name: "x" });
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toEqual({ name: "x" });
  });
});

describe("googleTypeFor", () => {
  it.each([
    [XLSX, GOOGLE_SHEET],
    ["application/vnd.ms-excel", GOOGLE_SHEET],
    ["application/vnd.openxmlformats-officedocument.spreadsheetml.template", GOOGLE_SHEET],
    [DOCX, GOOGLE_DOC],
    ["application/msword", GOOGLE_DOC],
    ["application/vnd.openxmlformats-officedocument.presentationml.presentation", GOOGLE_SLIDES],
    ["application/vnd.ms-powerpoint", GOOGLE_SLIDES],
  ])("%s converts to %s", (mime, google) => {
    expect(googleTypeFor(mime)).toBe(google);
  });

  it.each([GOOGLE_SHEET, "application/pdf", "text/csv", "", null, undefined])("%s does not convert", (mime) => {
    expect(googleTypeFor(mime)).toBeNull();
  });
});
