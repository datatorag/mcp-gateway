import type { GwsClient } from "../gws-client.js";
import type { ByteAttachment } from "../mime/build.js";
import { safeFilename, safeMimeType } from "../mime/build.js";
import { ByteBudget, mb, opener, type ByteSource, type Opener } from "./fetch.js";

/**
 * What each attachment entry becomes, decided before a single byte is
 * fetched (SCRUM-279).
 *
 * An entry is a Drive file id: a string, or `{file_id, as, tab}` to export a
 * Google Doc, Sheet or Slides deck. Files come from Drive and nowhere else;
 * bytes typed into the call are not a source, because a model transcribing a
 * file into a tool argument is exactly the transfer an MCP call should not
 * carry. A forward adds the original message's own attachments.
 *
 * Every refusal happens before any download: entry shapes synchronously,
 * then, once Drive's metadata is in, folders, formats a file cannot take, an
 * unknown tab, duplicate filenames and the 25 MB total. A refused call sends
 * nothing and fetches no file.
 */

export const MAX_ENTRIES = 10;
/** Raw bytes, as the user counts them; base64 growth is the transport's. */
export const TOTAL_CAP = 25 * 1024 * 1024;

const DOC = "application/vnd.google-apps.document";
const SHEET = "application/vnd.google-apps.spreadsheet";
const SLIDES = "application/vnd.google-apps.presentation";

interface ExportFormat {
  /** What files.export is asked for, or `sheetTab` for csv and tsv, which
   * are one tab each and read through the Sheets API. */
  exportAs: string | { sheetTab: "csv" | "tsv" };
  /** What the attached file is declared as. */
  mimeType: string;
  ext: string;
}

/** Google's export set for each native type, as (source type, format). A
 * pair not in this table is refused, naming both. */
export const EXPORTS: Record<string, { label: string; formats: Record<string, ExportFormat> }> = {
  [DOC]: {
    label: "Docs",
    formats: {
      pdf: { exportAs: "application/pdf", mimeType: "application/pdf", ext: ".pdf" },
      docx: {
        exportAs: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ext: ".docx",
      },
      txt: { exportAs: "text/plain", mimeType: "text/plain", ext: ".txt" },
      html: { exportAs: "text/html", mimeType: "text/html", ext: ".html" },
      md: { exportAs: "text/markdown", mimeType: "text/markdown", ext: ".md" },
      rtf: { exportAs: "application/rtf", mimeType: "application/rtf", ext: ".rtf" },
      odt: {
        exportAs: "application/vnd.oasis.opendocument.text",
        mimeType: "application/vnd.oasis.opendocument.text",
        ext: ".odt",
      },
      epub: { exportAs: "application/epub+zip", mimeType: "application/epub+zip", ext: ".epub" },
    },
  },
  [SHEET]: {
    label: "Sheets",
    formats: {
      pdf: { exportAs: "application/pdf", mimeType: "application/pdf", ext: ".pdf" },
      xlsx: {
        exportAs: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ext: ".xlsx",
      },
      csv: { exportAs: { sheetTab: "csv" }, mimeType: "text/csv", ext: ".csv" },
      tsv: { exportAs: { sheetTab: "tsv" }, mimeType: "text/tab-separated-values", ext: ".tsv" },
      // Google renders a spreadsheet as HTML inside a zip, one page per tab.
      html: { exportAs: "application/zip", mimeType: "application/zip", ext: ".zip" },
      ods: {
        exportAs: "application/vnd.oasis.opendocument.spreadsheet",
        mimeType: "application/vnd.oasis.opendocument.spreadsheet",
        ext: ".ods",
      },
    },
  },
  [SLIDES]: {
    label: "Slides",
    formats: {
      pdf: { exportAs: "application/pdf", mimeType: "application/pdf", ext: ".pdf" },
      pptx: {
        exportAs: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ext: ".pptx",
      },
      // The slides' visible text only.
      txt: { exportAs: "text/plain", mimeType: "text/plain", ext: ".txt" },
      odp: {
        exportAs: "application/vnd.oasis.opendocument.presentation",
        mimeType: "application/vnd.oasis.opendocument.presentation",
        ext: ".odp",
      },
    },
  },
};

/** Every format any source accepts, for the schema's enum. */
export const EXPORT_FORMATS = [...new Set(Object.values(EXPORTS).flatMap((s) => Object.keys(s.formats)))];

export interface ParsedEntry {
  fileId: string;
  as?: string;
  tab?: string;
}

/** A part of a message being forwarded that carries a filename. */
export interface OriginalPart {
  messageId: string;
  filename: string;
  mimeType?: string;
  size?: number;
  attachmentId?: string;
  /** Small parts arrive inline in the message resource instead. */
  data?: string;
  contentId?: string;
}

export type Mode = "attached" | "inline" | "linked" | "exported";

export interface ReportEntry {
  name: string;
  mode: Mode;
  source: "drive" | "original";
  file_id?: string;
  size?: number;
  link?: string;
  cid?: string;
  /** For a one-tab export, which tab went: "exported tab Sheet1 of 3". */
  note?: string;
}

export interface PlannedFile {
  filename: string;
  mimeType: string;
  contentId: string;
  open: Opener;
  report: ReportEntry;
}

export interface Resolved {
  links: Array<{ name: string; link: string }>;
  files: PlannedFile[];
  report: ReportEntry[];
}

const DRIVE_ID = /^[A-Za-z0-9_-]{1,200}$/;
const NATIVE = "application/vnd.google-apps.";
const FOLDER = "application/vnd.google-apps.folder";

function refuse(message: string): never {
  throw new Error(`${message} Nothing was sent.`);
}

/** Every shape rule, synchronously, so a malformed call costs no request. */
export function parseAttachments(value: unknown): ParsedEntry[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) refuse("attachments must be an array.");
  if (value.length > MAX_ENTRIES) refuse(`attachments holds ${value.length} entries; one message takes at most ${MAX_ENTRIES}.`);
  return value.map((entry, i): ParsedEntry => {
    if (typeof entry === "string") {
      if (!DRIVE_ID.test(entry)) refuse(`attachments[${i}] is not a Drive file id: ${JSON.stringify(entry.slice(0, 80))}.`);
      return { fileId: entry };
    }
    if (!entry || typeof entry !== "object" || (entry as Record<string, unknown>).file_id === undefined) {
      refuse(
        `attachments[${i}] must be a Drive file id, or {"file_id": ..., "as": ...}. Files are attached from Drive; put the file in Drive and pass its id.`
      );
    }
    const e = entry as Record<string, unknown>;
    const extra = Object.keys(e).filter((k) => !["file_id", "as", "tab"].includes(k));
    if (extra.length > 0) refuse(`attachments[${i}] has ${extra.map((k) => `"${k}"`).join(", ")}; an entry takes file_id, as and tab.`);
    if (typeof e.file_id !== "string" || !DRIVE_ID.test(e.file_id)) refuse(`attachments[${i}].file_id is not a Drive file id.`);
    if (e.as !== undefined && (typeof e.as !== "string" || !EXPORT_FORMATS.includes(e.as))) {
      refuse(`attachments[${i}].as must be one of ${EXPORT_FORMATS.join(", ")}.`);
    }
    if (e.tab !== undefined && (typeof e.tab !== "string" || e.tab === "")) refuse(`attachments[${i}].tab must be a tab title.`);
    if (e.tab !== undefined && e.as !== "csv" && e.as !== "tsv") {
      refuse(`attachments[${i}].tab applies only to "as": "csv" or "tsv", which export one tab.`);
    }
    return {
      fileId: e.file_id as string,
      ...(e.as ? { as: e.as as string } : {}),
      ...(e.tab ? { tab: e.tab as string } : {}),
    };
  });
}

/** The Content-ID a file gets from its name: the characters a `cid:` URL can
 * carry unescaped, anything else as `_`. `chart.png` is `cid:chart.png`. */
export function contentIdFor(filename: string): string {
  return safeFilename(filename).replace(/[^A-Za-z0-9._-]/g, "_");
}

/** A Content-ID copied from an inbound message, kept only as printable
 * characters that cannot close or break the header it goes into. */
function inboundContentId(raw: string | undefined): string | undefined {
  const inner = (raw ?? "").trim().replace(/^<|>$/g, "");
  return /^[\x21-\x7e]{1,250}$/.test(inner) && !/[<>"\\]/.test(inner) ? inner : undefined;
}

function driveLink(fileId: string, webViewLink: unknown): string {
  if (typeof webViewLink === "string") {
    try {
      const url = new URL(webViewLink);
      if (url.protocol === "https:" && /(^|\.)google\.com$/.test(url.hostname)) return url.toString();
    } catch {
      // fall through to the canonical form
    }
  }
  return `https://drive.google.com/open?id=${fileId}`;
}

interface DriveMeta {
  id?: string;
  name?: string;
  mimeType?: string;
  size?: string;
  webViewLink?: string;
}

async function driveMetadata(client: GwsClient, fileId: string): Promise<DriveMeta> {
  try {
    const res = await client.api("drive", "files", "get", {
      params: { fileId, fields: "id,name,mimeType,size,webViewLink", supportsAllDrives: true },
    });
    return (res.data ?? {}) as DriveMeta;
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    refuse(`Drive file ${fileId} could not be read (missing, or not shared with this account): ${why}.`);
  }
}

/** A spreadsheet's tab titles, in order, so a one-tab export can name the
 * tab it took and refuse one that does not exist before any download. */
async function sheetTabs(client: GwsClient, spreadsheetId: string, name: string): Promise<string[]> {
  let titles: string[];
  try {
    const res = await client.api("sheets", "spreadsheets", "get", {
      params: { spreadsheetId, fields: "sheets.properties.title" },
    });
    const sheets = (res.data as { sheets?: Array<{ properties?: { title?: string } }> } | undefined)?.sheets ?? [];
    titles = sheets.map((s) => s.properties?.title).filter((t): t is string => typeof t === "string");
  } catch (err) {
    const why = err instanceof Error ? err.message : String(err);
    refuse(`The tabs of "${name}" could not be read: ${why}.`);
  }
  if (titles.length === 0) refuse(`"${name}" reports no tabs to export.`);
  return titles;
}

type Pending = Omit<PlannedFile, "open"> & { source: ByteSource | Buffer; known?: number };

/** Metadata in, the per-file decision and the size check out. No file is
 * downloaded here; the openers it returns fetch when the message is streamed. */
export async function resolveAttachments(
  client: GwsClient,
  entries: ParsedEntry[],
  originalsIn: OriginalPart[] | Promise<OriginalPart[]> = []
): Promise<Resolved> {
  // A forward passes its originals as the pending fetch, so the Drive
  // metadata and the original message are read together.
  const [metas, originals] = await Promise.all([
    Promise.all(entries.map((e) => driveMetadata(client, e.fileId))),
    originalsIn,
  ]);

  const links: Resolved["links"] = [];
  // In the order the caller gave them, originals last.
  const report: ReportEntry[] = [];
  const pending: Pending[] = [];
  const plan = (p: Pending) => {
    pending.push(p);
    report.push(p.report);
  };

  // The tab lists a csv or tsv export needs, read alongside each other.
  const tabs = await Promise.all(
    entries.map((entry, i) => {
      const meta = metas[i];
      const format = entry.as ? EXPORTS[meta.mimeType ?? ""]?.formats[entry.as] : undefined;
      return format && typeof format.exportAs === "object"
        ? sheetTabs(client, entry.fileId, safeFilename(meta.name ?? entry.fileId))
        : Promise.resolve(undefined);
    })
  );

  entries.forEach((entry, i) => {
    const meta = metas[i];
    const name = safeFilename(meta.name ?? entry.fileId);
    const type = meta.mimeType ?? "";
    if (type === FOLDER) refuse(`"${name}" (${entry.fileId}) is a folder; only files can be attached.`);
    if (type.startsWith(NATIVE)) {
      if (!entry.as) {
        const link = driveLink(entry.fileId, meta.webViewLink);
        links.push({ name, link });
        report.push({ name, mode: "linked", source: "drive", file_id: entry.fileId, link });
        return;
      }
      const source = EXPORTS[type];
      const format = source?.formats[entry.as];
      if (!source) refuse(`"${name}" is a Google file type that cannot be exported; pass the id alone to send it as a link.`);
      if (!format) refuse(`"${name}": ${source.label} cannot be exported as ${entry.as}.`);
      let filename = name.toLowerCase().endsWith(format.ext) ? name : `${name}${format.ext}`;
      let byteSource: ByteSource;
      let note: string | undefined;
      if (typeof format.exportAs === "object") {
        const titles = tabs[i] as string[];
        const tab = entry.tab ?? titles[0];
        const index = titles.indexOf(tab);
        if (index === -1) {
          refuse(`"${name}" has no tab "${entry.tab}"; its tabs are ${titles.map((t) => `"${t}"`).join(", ")}.`);
        }
        filename = `${name} - ${tab}${format.ext}`;
        byteSource = { kind: "sheetTab", spreadsheetId: entry.fileId, tab, delimiter: format.exportAs.sheetTab };
        note = `exported tab ${tab} of ${titles.length}`;
      } else {
        byteSource = { kind: "export", fileId: entry.fileId, mimeType: format.exportAs };
      }
      const safe = safeFilename(filename);
      plan({
        filename: safe,
        mimeType: format.mimeType,
        contentId: contentIdFor(safe),
        source: byteSource,
        report: { name: safe, mode: "exported", source: "drive", file_id: entry.fileId, ...(note ? { note } : {}) },
      });
      return;
    }
    if (entry.as) {
      refuse(`"${name}" is not a Google Doc, Sheet or Slides deck, so it cannot take "as"; pass the id alone to attach it as it is.`);
    }
    const size = Number(meta.size);
    if (meta.size === undefined || !Number.isFinite(size)) refuse(`"${name}" (${entry.fileId}) has no size Drive will report, so it cannot be checked against the limit.`);
    plan({
      filename: name,
      mimeType: safeMimeType(type),
      contentId: contentIdFor(name),
      source: { kind: "drive", fileId: entry.fileId },
      known: size,
      report: { name, mode: "attached", source: "drive", file_id: entry.fileId, size },
    });
  });

  // Two of the caller's files with one name would share a Content-ID, so a
  // `cid:` reference could not say which it meant, and the recipient would
  // see two attachments they cannot tell apart. Refused, naming the name.
  // The same holds for two names that differ only in the characters a
  // Content-ID replaces ("a b.png" and "a_b.png").
  const seen = new Map<string, string>();
  for (const p of pending) {
    const clash = seen.get(p.contentId);
    if (clash !== undefined) {
      refuse(
        clash === p.filename
          ? `Two attachments are named "${p.filename}"; each file in a message needs its own name.`
          : `"${clash}" and "${p.filename}" would share the Content-ID "${p.contentId}"; rename one of them.`
      );
    }
    seen.set(p.contentId, p.filename);
  }

  for (const part of originals) {
    const name = safeFilename(part.filename);
    const source = part.attachmentId
      ? { kind: "gmail" as const, messageId: part.messageId, attachmentId: part.attachmentId }
      : Buffer.from(part.data ?? "", "base64url");
    const known = Buffer.isBuffer(source) ? source.length : (part.size ?? 0);
    // An original keeps its own Content-ID, which is what its quoted HTML
    // references. One without gets a derived id, made unique rather than
    // refused: mail routinely carries two files with one name, and nothing
    // can reference an original that never had an id of its own.
    let contentId = inboundContentId(part.contentId);
    if (!contentId) {
      const base = contentIdFor(name);
      contentId = base;
      for (let n = 2; seen.has(contentId); n++) contentId = `${n}.${base}`;
    }
    seen.set(contentId, name);
    plan({
      filename: name,
      mimeType: safeMimeType(part.mimeType),
      contentId,
      source,
      known,
      report: { name, mode: "attached", source: "original", size: known },
    });
  }

  // The limit, from what is known, before anything is fetched. Exports have
  // no size until Google renders them; the budget below counts those as they
  // stream.
  let total = 0;
  for (const p of pending) {
    total += p.known ?? 0;
    if (total > TOTAL_CAP) {
      refuse(`"${p.filename}" takes the attachments to ${mb(total)}, over the ${mb(TOTAL_CAP)} limit.`);
    }
  }

  const budget = new ByteBudget(TOTAL_CAP);
  const files: PlannedFile[] = pending.map((p) => {
    const raw: Opener = Buffer.isBuffer(p.source)
      ? async function* () {
          yield p.source as Buffer;
        }
      : opener(client, p.source);
    const entryReport = p.report;
    const open = budget.meter(p.filename, raw, (bytes) => {
      entryReport.size = bytes;
    });
    return { filename: p.filename, mimeType: p.mimeType, contentId: p.contentId, report: entryReport, open };
  });

  return { links, files, report };
}

/** Whether the HTML references this Content-ID, so the file belongs in place
 * rather than at the bottom. */
export function referencesCid(html: string | undefined, cid: string): boolean {
  if (!html) return false;
  const escaped = cid.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`cid:${escaped}(?![A-Za-z0-9._@-])`, "i").test(html);
}

/** The files as the builder takes them, each placed by whether the final
 * HTML references it. A file referenced inline is not listed again as an
 * attachment. */
export function placeFiles(files: PlannedFile[], html: string | undefined): ByteAttachment[] {
  return files.map((f) => {
    const inline = referencesCid(html, f.contentId);
    if (inline) {
      // An export keeps saying it was exported; where it sits is in `cid`.
      if (f.report.mode === "attached") f.report.mode = "inline";
      f.report.cid = f.contentId;
    }
    return {
      filename: f.filename,
      mimeType: f.mimeType,
      contentId: f.contentId,
      disposition: inline ? "inline" : "attachment",
      open: f.open,
    };
  });
}
