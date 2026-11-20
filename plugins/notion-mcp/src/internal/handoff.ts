/**
 * The body the gateway hands this plugin on the consume route (SCRUM-437):
 * `multipart/form-data` with the tool's arguments as JSON in an `args` field
 * and one field per file, `file` or `attachments[i]`, each carrying its own
 * name and type.
 *
 * Parsed with the runtime's own `Response.formData()`, after the route has
 * read the body under its cap, so there is no framing of ours to get wrong.
 * Every field is checked by name; anything the gateway would not send is a
 * refusal, and nothing from a refused body reaches the service.
 *
 * The same module lives in each plugin that takes files: the plugins share
 * no package.
 */

/** A file as the gateway hands it over: the bytes, and what to call them. */
export interface HandedFile {
  bytes: Uint8Array;
  name: string;
  type: string;
}

/** The arguments field, at most. An email's body fits; nothing else needs more. */
export const MAX_ARGS_BYTES = 1024 * 1024;

/** The only fields a file can arrive in: the one file of a tool that takes
 * one, or the i-th entry of an email's attachments. */
const FILE_FIELD = /^(?:file|attachments\[[0-9]\])$/;

export class BadHandoff extends Error {}

export function isMultipart(contentType: string | undefined): boolean {
  return typeof contentType === "string" && /^multipart\/form-data\s*;\s*boundary=/i.test(contentType);
}

/**
 * The arguments and the files of one handoff. Throws `BadHandoff` with a
 * sentence for the gateway's refusal; never echoes a value it was sent.
 */
export async function parseHandoff(
  body: Uint8Array,
  contentType: string
): Promise<{ args: Record<string, unknown>; files: Map<string, HandedFile> }> {
  let form: FormData;
  try {
    form = await new Response(body as Uint8Array<ArrayBuffer>, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new BadHandoff("The body is not a readable multipart form.");
  }

  const seen = new Set<string>();
  const files = new Map<string, HandedFile>();
  let args: Record<string, unknown> | undefined;
  for (const [field, value] of form.entries()) {
    if (seen.has(field)) throw new BadHandoff("A field appears more than once.");
    seen.add(field);
    if (field === "args") {
      if (typeof value !== "string") throw new BadHandoff("The args field must be text.");
      if (Buffer.byteLength(value, "utf8") > MAX_ARGS_BYTES) throw new BadHandoff("The args field is too large.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new BadHandoff("The args field must be a JSON object.");
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new BadHandoff("The args field must be a JSON object.");
      }
      args = parsed as Record<string, unknown>;
    } else if (FILE_FIELD.test(field)) {
      if (typeof value === "string") throw new BadHandoff("A file field must carry a file.");
      if (!value.name) throw new BadHandoff("A file arrived with no name.");
      const bytes = new Uint8Array(await value.arrayBuffer());
      if (bytes.byteLength === 0) throw new BadHandoff("A file arrived empty.");
      files.set(field, { bytes, name: value.name, type: value.type || "application/octet-stream" });
    } else {
      throw new BadHandoff("The body carries a field this route does not take.");
    }
  }
  if (!args) throw new BadHandoff("The body has no args field.");
  return { args, files };
}

/** The bytes of every file, together. */
export function totalBytes(files: Map<string, HandedFile>): number {
  let total = 0;
  for (const file of files.values()) total += file.bytes.byteLength;
  return total;
}
