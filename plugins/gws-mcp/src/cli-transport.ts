import { execFile, spawn, type ChildProcess } from "node:child_process";
import { writeFile, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { promisify } from "node:util";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { throwGwsError } from "./google-api/errors.js";
import { scopesForServices } from "./scopes.js";
import type { ApiOptions, ApiResult } from "./google-api/direct-transport.js";

/* THE CLI FALLBACK TRANSPORT (SCRUM-289).
 *
 * Every hosted call carries a per-user bearer token and goes to Google
 * directly; none of this module runs for them, and it is imported lazily so
 * they never load it. What is left here serves one case: a self-hosted
 * install with no token, where the gws CLI holds the credentials from its own
 * `auth login` and is the only thing that can make an authenticated call. It
 * also owns `gws_auth_setup`'s login flow.
 *
 * The argv and stdout limits below are properties of THIS transport. They
 * left the hosted path with it and stay here only because the CLI still has
 * them. The whole module goes when a native OAuth flow replaces the CLI login. */

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Linux refuses a single argv string longer than 128KB (MAX_ARG_STRLEN,
 * 32 pages). The request body travels as one `--json` argument, so a large
 * message hits that ceiling and execFile fails with E2BIG. macOS accepts far
 * more, so this does NOT reproduce on a development Mac — it only appears in
 * production. Hold the budget below the kernel's so the failure names the
 * size and the cap instead of surfacing "Argument list too long". */
export const ARGV_STRING_MAX = 128 * 1024;
const ARGV_BUDGET = ARGV_STRING_MAX - 1024;

/** Whether a serialized request body fits in one argv string. Exported so a
 * caller that must not fail the whole call (gmail_send_draft, which sends the
 * draft unchanged instead) can decide before it rewrites anything. */
export function argvStringFits(serialized: string): boolean {
  return Buffer.byteLength(serialized, "utf8") <= ARGV_BUDGET;
}

function assertArgvStringFits(label: string, serialized: string): void {
  if (argvStringFits(serialized)) return;
  throw new Error(
    `${label} is ${Buffer.byteLength(serialized, "utf8")} bytes; one argument to the ` +
      `gws CLI can carry at most ${ARGV_BUDGET} (the OS limit is ${ARGV_STRING_MAX}). ` +
      `Send less content in one call.`
  );
}

function getGwsBinaryPath(): string {
  const platform = process.platform;
  const arch = process.arch;
  const binDir = path.join(__dirname, "..", "bin");

  if (platform === "darwin" && arch === "arm64")
    return path.join(binDir, "gws-aarch64-apple-darwin", "gws");
  if (platform === "darwin" && arch === "x64")
    return path.join(binDir, "gws-x86_64-apple-darwin", "gws");
  if (platform === "linux" && arch === "x64")
    return path.join(binDir, "gws-x86_64-unknown-linux-gnu", "gws");
  if (platform === "win32" && arch === "x64")
    return path.join(binDir, "gws.exe");

  throw new Error(
    `Unsupported platform: ${platform}/${arch}. Supported: macOS (arm64, x64), Linux (x64), Windows (x64).`
  );
}

/** Resolved on first use, not at import: a platform the CLI has no binary for
 * can still run the hosted path, which never gets here. */
let _binary: string | undefined;
const gwsBinaryPath = () => (_binary ??= getGwsBinaryPath());

/** The most informative thing we can say about a failed gws invocation.
 *
 * Order matters. stderr is the CLI's own diagnostic. stdout is where the API's
 * error body lands when the call reached Google and was rejected there, which
 * is the case a caller most needs to see: it names the field and the reason.
 *
 * The last resort is deliberately NOT `error.message`. Node sets that to
 * "Command failed: <the entire command line>", and for these calls the command
 * line contains the whole serialised batchUpdate request. Echoing it produced
 * pages of JSON that named neither the failing field nor the reason, which is
 * strictly worse than saying nothing: it looks like a diagnostic, so it stops
 * you looking for one. A batchUpdate is atomic, so one bad request fails the
 * whole pass and the caller has no way to tell which. */
function errorDetail(error: {
  code?: number | string;
  stdout?: string;
  stderr?: string;
  message?: string;
}): string {
  const stderr = error.stderr?.trim();
  if (stderr) return stderr;

  const stdout = error.stdout?.trim();
  if (stdout) {
    try {
      const parsed = JSON.parse(stdout) as { error?: { message?: string } };
      const apiMessage = parsed?.error?.message;
      if (apiMessage) return apiMessage;
      return JSON.stringify(parsed);
    } catch {
      return stdout;
    }
  }

  return `gws exited with code ${error.code ?? "unknown"} and produced no diagnostic output`;
}

export class CliTransport {
  constructor(private mergedEnv: NodeJS.ProcessEnv) {}


  /** Clear stored credentials so the next login gets a fresh token. */
  async logout(): Promise<void> {
    try {
      await execFileAsync(gwsBinaryPath(), ["auth", "logout"], {
        timeout: 10_000,
        env: this.mergedEnv,
        cwd: os.tmpdir(),
      });
    } catch {
      // Ignore — may already be logged out
    }
  }

  /** Spawn a background auth login process. Returns the child for stderr monitoring. */
  private spawnAuth(services: string): ChildProcess {
    const scopes = scopesForServices(services);
    const scopeArgs = scopes
      ? ["--scopes", scopes.join(",")]
      : ["-s", services];
    const child = spawn(
      gwsBinaryPath(),
      ["auth", "login", ...scopeArgs],
      { env: this.mergedEnv, stdio: ["ignore", "pipe", "pipe"] }
    );
    child.unref();
    return child;
  }

  /**
   * Spawn a background auth login and resolve with the OAuth URL the gws
   * binary prints to stderr — or undefined if the process closes or the
   * timeout elapses without one. The login process keeps running in the
   * background either way so the browser flow can complete.
   */
  spawnAuthForUrl(services: string, timeoutMs = 10_000): Promise<string | undefined> {
    const child = this.spawnAuth(services);
    return new Promise((resolve) => {
      let buf = "";
      const timer = setTimeout(() => resolve(undefined), timeoutMs);
      timer.unref?.();
      child.stderr?.on("data", (chunk: Buffer) => {
        buf += chunk.toString();
        const match = buf.match(
          /(https:\/\/accounts\.google\.com\/o\/oauth2\/auth\S+)/
        );
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
      child.on("close", () => {
        clearTimeout(timer);
        resolve(undefined);
      });
    });
  }

  async exec(
    args: string[],
    options?: { timeout?: number }
  ): Promise<ApiResult> {
    const timeout = options?.timeout ?? 30_000;
    const env = this.mergedEnv;

    try {
      const { stdout, stderr } = await execFileAsync(gwsBinaryPath(), args, {
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        env,
        cwd: os.tmpdir(),
      });

      let data: unknown;
      try {
        data = JSON.parse(stdout);
      } catch {
        data = stdout.trim();
      }

      return { success: true, data };
    } catch (err: unknown) {
      const error = err as {
        code?: number | string;
        stdout?: string;
        stderr?: string;
        message?: string;
      };

      if (error.code === "ENOENT") {
        // The binaries are opt-in since SCRUM-289: a hosted install never
        // needs them, so `build` no longer downloads them.
        throw new Error(
          "The gws CLI is not installed. It is only needed for a self-hosted login " +
            "(gws_auth_setup) and for calls made without a gateway-supplied token. " +
            "Install it with: npm run download-binaries"
        );
      }
      if (error.code === 2) {
        throw new Error(
          "Google Workspace authentication required. Use the gws_auth_setup tool to authenticate."
        );
      }
      if (error.code === 3) {
        throw new Error(`Validation error: ${errorDetail(error)}`);
      }
      if (error.code === 4) {
        throw new Error(`API discovery error: ${errorDetail(error)}`);
      }

      if (error.stdout) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(error.stdout);
        } catch {
          // stdout wasn't JSON — fall through to the generic error below
        }
        if (parsed !== undefined) {
          throwGwsError(`API error: ${JSON.stringify(parsed)}`);
        }
      }

      throwGwsError(error.stderr || error.message || "Unknown gws error");
    }
  }

  async helper(
    service: string,
    command: string,
    flags: Record<string, string | boolean>,
    opts?: { positional?: string[]; timeout?: number }
  ): Promise<ApiResult> {
    const args = [service, `+${command}`, ...(opts?.positional ?? [])];
    for (const [key, value] of Object.entries(flags)) {
      if (value === true) args.push(`--${key}`);
      else if (value) args.push(`--${key}`, value);
    }
    return this.exec(args, { timeout: opts?.timeout });
  }


  async api(
    service: string,
    resource: string,
    method: string,
    options?: ApiOptions
  ): Promise<ApiResult> {
    const args = [service, ...resource.split("."), method];

    if (options?.params) {
      const params = JSON.stringify(options.params);
      assertArgvStringFits("--params", params);
      args.push("--params", params);
    }
    if (options?.jsonBody) {
      const jsonBody = JSON.stringify(options.jsonBody);
      assertArgvStringFits("The request body", jsonBody);
      args.push("--json", jsonBody);
    }
    if (options?.pageAll) {
      args.push("--page-all", "--page-limit", "10");
    }
    if (options?.dryRun) {
      args.push("--dry-run");
    }

    const timeout = options?.pageAll ? 120_000 : 30_000;
    return this.exec(args, { timeout });
  }

  /** Save a Gmail attachment to Drive through the CLI's upload helper, which
   * only accepts a file on disk. */
  async gmailAttachmentToDrive(args: {
    messageId: string;
    attachmentId: string;
    name: string;
    parent?: string;
  }): Promise<ApiResult> {
    const attach = await this.api("gmail", "users.messages.attachments", "get", {
      params: { userId: "me", messageId: args.messageId, id: args.attachmentId },
    });
    const data = (attach.data as { data?: string } | undefined)?.data;
    if (!data) throw new Error("No attachment data returned from Gmail API");
    const tmpFile = path.join(os.tmpdir(), `gws-attach-${randomUUID()}`);
    try {
      await writeFile(tmpFile, Buffer.from(data, "base64url"), { mode: 0o600 });
      const flags: Record<string, string> = { name: args.name };
      if (args.parent) flags.parent = args.parent;
      return await this.helper("drive", "upload", flags, { positional: [tmpFile], timeout: 120_000 });
    } finally {
      await unlink(tmpFile).catch(() => {});
    }
  }


  async authStatus(): Promise<ApiResult> {
    try {
      return await this.exec(["auth", "status"]);
    } catch {
      return { success: false, data: null };
    }
  }

}
