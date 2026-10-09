import { readFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
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
import type { CliTransport } from "./cli-transport.js";

export { DEFAULT_SERVICES, REQUIRED_SCOPE_KEYWORDS, scopesForServices } from "./scopes.js";
export { TransientGwsError, errorMessage, isTransient } from "./google-api/errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let _bundledOAuth: { clientId?: string; clientSecret?: string } | undefined;
function loadBundledOAuth(): { clientId?: string; clientSecret?: string } {
  if (_bundledOAuth) return _bundledOAuth;
  try {
    const raw = readFileSync(path.join(__dirname, "oauth.json"), "utf-8");
    _bundledOAuth = JSON.parse(raw) as { clientId?: string; clientSecret?: string };
  } catch {
    _bundledOAuth = {};
  }
  return _bundledOAuth;
}

export type GwsResult = ApiResult;

/**
 * Refuse the one query-parameter shape this transport cannot carry: an array
 * whose elements are not scalars.
 *
 * Params reach the binary as one `--params` JSON blob. The vendored gws CLI
 * (0.17.0, pinned by download-binaries.sh) turns an array of scalars into a
 * REPEATED query key, which is what the Google APIs expect for `ranges`,
 * `metadataHeaders`, `labelIds` and every other parameter their discovery
 * document marks `repeated`: `ranges: ["A!A1", "A!A9"]` goes out as
 * `ranges=A!A1&ranges=A!A9`. Measured with `--dry-run` on the pinned binary,
 * and pinned by the transport test beside this file, because an earlier
 * version of this guard asserted the opposite from memory and blocked every
 * such call for months (SCRUM-178).
 *
 * What the binary still cannot express is an element that is itself an
 * array or an object: it stringifies the element into one query value and
 * Google reads JSON where it wanted a range or a header name. That failure
 * would come back blaming the caller's input, which was fine, so it is
 * refused here, before the call, with the shape named.
 *
 * A scalar array on a parameter the API does NOT mark repeated is left to
 * the binary: it prints a warning on stderr and sends the stringified value,
 * and when Google rejects that, `errorDetail` surfaces the warning first.
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
      `which the gws CLI transport sends as one literal JSON value the API cannot read. ` +
      `Pass one scalar per element; a repeated query parameter takes ["A", "B"].`
  );
}

export interface GwsClientOptions {
  accessToken?: string;
}

const NEEDS_TOKEN = "This call needs an access token; connect the account through the gateway and try again.";

/** The client every tool calls.
 *
 * TWO TRANSPORTS, CHOSEN BY ONE FACT: whether this client holds a bearer
 * token (SCRUM-289). With one, which is every hosted call, requests go to the
 * Google REST endpoints directly and no process is ever spawned. Without one,
 * which is a self-hosted install relying on the gws CLI's own stored login,
 * calls fall back to the CLI transport, loaded on first use. */
export class GwsClient {
  private mergedEnv: NodeJS.ProcessEnv;
  private defaultAccessToken?: string;
  private _cli?: Promise<CliTransport>;

  constructor(options?: GwsClientOptions) {
    const env: Record<string, string> = {};
    const bundled = loadBundledOAuth();
    const clientId = process.env.GWS_OAUTH_CLIENT_ID || bundled.clientId;
    const clientSecret = process.env.GWS_OAUTH_CLIENT_SECRET || bundled.clientSecret;
    if (clientId) env.GOOGLE_WORKSPACE_CLI_CLIENT_ID = clientId;
    if (clientSecret) env.GOOGLE_WORKSPACE_CLI_CLIENT_SECRET = clientSecret;
    // Ensure gws has a writable config dir (Claude Desktop sandbox is read-only)
    if (!process.env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR) {
      env.GOOGLE_WORKSPACE_CLI_CONFIG_DIR = path.join(os.homedir(), ".config", "gws");
    }
    this.mergedEnv = { ...process.env, ...env };
    this.defaultAccessToken = options?.accessToken;
  }

  /** Returns a new GwsClient that uses the given access token for all calls.
   * The constructor is deterministic (env + cached bundled OAuth), so a plain
   * re-construction gives the same client without prototype surgery. */
  withToken(accessToken: string): GwsClient {
    return new GwsClient({ accessToken });
  }

  /** The CLI fallback, imported only when a call actually needs it. */
  private cli(): Promise<CliTransport> {
    return (this._cli ??= import("./cli-transport.js").then((m) => new m.CliTransport(this.mergedEnv)));
  }


  /** A plain authenticated GET, for the one Google surface the CLI cannot
   * reach: the Visualization query endpoint behind sheets_query (SCRUM-261)
   * is not a discovery-based API, so it is fetched directly with the same
   * access token the CLI calls carry. Text in, text out; the caller parses.
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
    if (token) return directApi(token, service, resource, method, options);
    return (await this.cli()).api(service, resource, method, options);
  }

  /** Send bytes to a method that accepts media (Drive files.create, Gmail
   * drafts and messages). `source` is consumed as it is sent, in bounded
   * chunks, so the caller never holds the whole file. Needs a token: the CLI
   * fallback has no streaming upload. */
  async upload(service: string, resource: string, method: string, options: UploadOptions): Promise<GwsResult> {
    const token = this.defaultAccessToken;
    if (!token) throw new Error(NEEDS_TOKEN);
    return directUpload(token, service, resource, method, options);
  }

  /** Open a response as a byte stream: `alt=media` where the method supports
   * it, the plain body otherwise. Needs a token, as upload does. */
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
   * the conversation. With a token the attachment is decoded as it streams
   * in and uploaded in bounded chunks; nothing touches the disk. */
  async gmailAttachmentToDrive(args: {
    messageId: string;
    attachmentId: string;
    name: string;
    parent?: string;
  }): Promise<GwsResult> {
    if (!this.defaultAccessToken) return (await this.cli()).gmailAttachmentToDrive(args);

    const attachment = await this.download("gmail", "users.messages.attachments", "get", {
      userId: "me",
      messageId: args.messageId,
      id: args.attachmentId,
    });
    return this.upload("drive", "files", "create", {
      params: { supportsAllDrives: true, fields: "id,name,mimeType,size,webViewLink,parents" },
      metadata: { name: args.name, ...(args.parent ? { parents: [args.parent] } : {}) },
      // No type is claimed for the bytes, so Drive detects it from the name
      // and content, as it did for the CLI's upload of an extensionless file.
      contentType: "application/octet-stream",
      source: gmailAttachmentBytes(attachment.stream as unknown as AsyncIterable<Uint8Array>),
    });
  }

  /** Clear stored credentials so the next login gets a fresh token. */
  async logout(): Promise<void> {
    return (await this.cli()).logout();
  }

  /** Start the CLI's login in the background and resolve with its OAuth URL. */
  async spawnAuthForUrl(services: string, timeoutMs = 10_000): Promise<string | undefined> {
    return (await this.cli()).spawnAuthForUrl(services, timeoutMs);
  }

  async authStatus(): Promise<GwsResult> {
    return (await this.cli()).authStatus();
  }
}
