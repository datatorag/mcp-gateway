import {
  DEFAULT_TIMEOUT_MS,
  directApi,
  directDownload,
  readCapped,
  sendAuthorized,
  type ApiOptions,
  type ApiResult,
  type DownloadResult,
} from "./google-api/direct-transport.js";
import { directUpload, gmailAttachmentBytes, type UploadOptions } from "./google-api/direct-upload.js";

export { TransientGwsError, errorMessage, isTransient } from "./google-api/errors.js";

export type GwsResult = ApiResult;

/**
 * Refuse the one query-parameter shape a request cannot carry: an array whose
 * elements are not scalars.
 *
 * An array of scalars goes out as a REPEATED query key, which is what the
 * Google APIs expect for `ranges`, `metadataHeaders`, `labelIds` and every
 * other parameter their discovery document marks `repeated`:
 * `ranges: ["A!A1", "A!A9"]` is sent as `ranges=A!A1&ranges=A!A9`. An
 * earlier version of this guard asserted the opposite from memory and
 * blocked every such call for months (SCRUM-178); the recorded requests in
 * google-api/oracle.fixtures.json pin the real behaviour.
 *
 * What a query string cannot express is an element that is itself an array
 * or an object: it would go out as one stringified value and Google would
 * read JSON where it wanted a range or a header name. That failure would
 * come back blaming the caller's input, which was fine, so it is refused
 * here, before the call, with the shape named.
 */
function assertCarriableParams(params: Record<string, unknown>): void {
  const nested = Object.entries(params)
    .filter(
      ([, value]) =>
        Array.isArray(value) &&
        value.some((element) => element === null || typeof element === "object")
    )
    .map(([key]) => key);
  if (nested.length === 0) return;
  throw new Error(
    `Array parameters must hold only strings, numbers or booleans; ` +
      `${nested.map((k) => `"${k}"`).join(", ")} ` +
      `${nested.length === 1 ? "holds" : "hold"} nested arrays or objects, ` +
      `which would be sent as one literal JSON value the API cannot read. ` +
      `Pass one scalar per element; a repeated query parameter takes ["A", "B"].`
  );
}

export interface GwsClientOptions {
  accessToken?: string;
}

const NEEDS_TOKEN = "This call needs an access token; connect the account through the gateway and try again.";

/** The client every tool calls.
 *
 * ONE TRANSPORT (SCRUM-289, SCRUM-390): requests go to the Google REST
 * endpoints directly, with the bearer token the gateway sends for the user
 * the call is for. No process is started. A client with no token cannot call
 * anything and says so; there is no stored login to fall back to. */
export class GwsClient {
  private defaultAccessToken?: string;

  constructor(options?: GwsClientOptions) {
    this.defaultAccessToken = options?.accessToken;
  }

  /** Returns a new GwsClient that uses the given access token for all calls. */
  withToken(accessToken: string): GwsClient {
    return new GwsClient({ accessToken });
  }

  /** A plain authenticated GET, for the one Google surface the method table
   * does not cover: the Visualization query endpoint behind sheets_query
   * (SCRUM-261) is not a discovery-based API, so it is fetched directly with
   * the same access token every other call carries. Text in, text out; the caller parses.
   * Refuses without a token rather than sending an anonymous request that
   * would answer with a login page for any private file. */
  async fetchText(url: string, options?: { timeout?: number }): Promise<{ status: number; text: string }> {
    const token = this.defaultAccessToken;
    if (!token) throw new Error(NEEDS_TOKEN);
    // The token goes only to Google. A general authenticated GET would be a
    // token-exfiltration primitive the moment a caller built its URL from
    // user input, so the hosts are pinned by the transport's "visualization"
    // destination, not left to each caller, and the request goes through the
    // same guarded send as every API call.
    const res = await sendAuthorized(token, { method: "GET", url }, "fetchText", {
      timeout: options?.timeout ?? DEFAULT_TIMEOUT_MS,
      destination: "visualization",
    });
    return { status: res.status, text: await readCapped(res, "fetchText") };
  }

  async api(service: string, resource: string, method: string, options?: ApiOptions): Promise<GwsResult> {
    if (options?.params) assertCarriableParams(options.params);
    const token = this.defaultAccessToken;
    if (!token) throw new Error(NEEDS_TOKEN);
    return directApi(token, service, resource, method, options);
  }

  /** Send bytes to a method that accepts media (Drive files.create, Gmail
   * drafts and messages). `source` is consumed as it is sent, in bounded
   * chunks, so the caller never holds the whole file. */
  async upload(service: string, resource: string, method: string, options: UploadOptions): Promise<GwsResult> {
    const token = this.defaultAccessToken;
    if (!token) throw new Error(NEEDS_TOKEN);
    return directUpload(token, service, resource, method, options);
  }

  /** Open a response as a byte stream: `alt=media` where the method supports
   * it, the plain body otherwise. */
  async download(
    service: string,
    resource: string,
    method: string,
    params: Record<string, unknown>
  ): Promise<DownloadResult> {
    const token = this.defaultAccessToken;
    if (!token) throw new Error(NEEDS_TOKEN);
    return directDownload(token, service, resource, method, params);
  }

  /** Copy one Gmail attachment into Drive without the bytes passing through
   * the conversation. The attachment is decoded as it streams in and
   * uploaded in bounded chunks; nothing touches the disk. */
  async gmailAttachmentToDrive(args: {
    messageId: string;
    attachmentId: string;
    name: string;
    parent?: string;
  }): Promise<GwsResult> {
    const attachment = await this.download("gmail", "users.messages.attachments", "get", {
      userId: "me",
      messageId: args.messageId,
      id: args.attachmentId,
    });
    return this.upload("drive", "files", "create", {
      params: { supportsAllDrives: true, fields: "id,name,mimeType,size,webViewLink,parents" },
      metadata: { name: args.name, ...(args.parent ? { parents: [args.parent] } : {}) },
      // No type is claimed for the bytes, so Drive detects it from the name
      // and content.
      contentType: "application/octet-stream",
      source: gmailAttachmentBytes(attachment.stream as unknown as AsyncIterable<Uint8Array>),
    });
  }
}
