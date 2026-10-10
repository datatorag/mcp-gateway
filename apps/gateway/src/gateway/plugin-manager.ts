import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Database } from "@datatorag-mcp/db";
import {
  mcpServers,
  mcpServerEnvVars,
  tools,
} from "@datatorag-mcp/db";
import type { McpGatewayManifest } from "@datatorag-mcp/types";
import type { ConnectionPool } from "./pool";
import { sendSlack } from "@/lib/slack";
import { PLUGINS_DIR, PLUGINS_FROM_IMAGE } from "./plugins-dir";

export { pluginsDirFrom, PLUGINS_DIR, PLUGINS_FROM_IMAGE } from "./plugins-dir";

const BASE_PORT = 40000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const NAMESPACE_SEPARATOR = "__";

const MAX_RESPAWNS = 3;
const RESPAWN_WINDOW_MS = 60_000;

/** What a plugin child takes from the gateway's own environment. Everything
 * else the gateway holds (the database URL, OAuth client secrets, provider
 * keys, session material) stays in the gateway. */
const INHERITED_ENV_KEYS = ["PATH", "NODE_ENV"] as const;

/** A row key must be a plain variable name. The child's environment is
 * written as `key=value` pairs, so a key carrying its own `=` would set a
 * different name than the one checked below. */
const ENV_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Row keys a plugin's env rows may not set: the names the manager sets
 * itself, and the ones that change how the child process runs. */
function isReservedEnvKey(key: string): boolean {
  return (
    key === "PORT" ||
    key === "PATH" ||
    key === "NODE_ENV" ||
    key === "NODE_OPTIONS" ||
    key.startsWith("LD_")
  );
}

/**
 * The whole environment of a plugin child (SCRUM-390): `PATH` and `NODE_ENV`
 * from the gateway, `PORT` from the registry row, and that plugin's own env
 * rows as literal values. Nothing else is passed, so a plugin (or a
 * dependency of one) that logs or sends its environment has none of the
 * gateway's keys to leak.
 *
 * A row value starting with `$` used to copy a named variable out of the
 * gateway's environment. That form is gone: such a row is refused and left
 * out, never passed as a literal. A row with a reserved key is refused the
 * same way, and so is a key that is not a plain variable name. `refused`
 * carries one line per refused row. It names a well-formed key, prints
 * nothing of a malformed one, and never prints a value.
 */
export function buildPluginEnv(
  parentEnv: Record<string, string | undefined>,
  port: number,
  rows: { key: string; value: string }[]
): { env: Record<string, string>; refused: string[] } {
  const env: Record<string, string> = {};
  const refused: string[] = [];
  for (const key of INHERITED_ENV_KEYS) {
    const value = parentEnv[key];
    if (value !== undefined) env[key] = value;
  }
  env.PORT = String(port);
  for (const row of rows) {
    if (!ENV_KEY_PATTERN.test(row.key)) {
      // Nothing of such a key is printed: a key that is not a name is most
      // likely a value in the wrong column.
      refused.push(`a row whose key is not a variable name (${row.key.length} characters)`);
    } else if (isReservedEnvKey(row.key)) {
      refused.push(`${row.key}: reserved key`);
    } else if (row.value.startsWith("$")) {
      refused.push(`${row.key}: value starts with "$"`);
    } else {
      env[row.key] = row.value;
    }
  }
  return { env, refused };
}

export type PluginUser = { uid: number; gid: number };

/** The account a plugin child runs as, by name: one per plugin, so neither
 * can read the other's process either. */
export function pluginUserName(slug: string): string {
  return `plugin-${slug}`;
}

/**
 * The user and group id of a plugin's own account, read from the text of a
 * passwd file (SCRUM-390). Null when there is no such account, when its line
 * cannot be read, or when it is root: an account named for a plugin that
 * maps to uid or gid 0 is a mistake in the image, and starting the plugin
 * with it would be starting it as root under another name.
 */
export function pluginUserFrom(passwd: string, slug: string): PluginUser | null {
  const name = pluginUserName(slug);
  for (const line of passwd.split("\n")) {
    const fields = line.split(":");
    if (fields[0] !== name) continue;
    if (!/^\d+$/.test(fields[2] ?? "") || !/^\d+$/.test(fields[3] ?? "")) return null;
    const uid = Number(fields[2]);
    const gid = Number(fields[3]);
    if (uid === 0 || gid === 0) return null;
    return { uid, gid };
  }
  return null;
}

/**
 * Who a plugin child runs as. `undefined` means as the gateway itself, which
 * is a laptop and any plugin that is not the image's. `null` means it should
 * have had its own account and has none, and then it is not started.
 */
export type PluginUserLookup = (slug: string) => PluginUser | null | undefined;

/**
 * When the plugins are the image's, each runs as its own non-root account,
 * which the image creates (SCRUM-390). A process of another user cannot read
 * the gateway's environment or memory, so the keys the gateway holds stay out
 * of reach of a plugin that has been taken over, and not only of one that
 * logs its environment by accident. There is no fallback to the gateway's
 * own user: a plugin with no account is left down.
 */
const imagePluginUser: PluginUserLookup = (slug) => {
  if (!PLUGINS_FROM_IMAGE) return undefined;
  try {
    return pluginUserFrom(readFileSync("/etc/passwd", "utf-8"), slug);
  } catch {
    return null;
  }
};

export type PluginStatus = "up" | "down";

interface RunningPlugin {
  process: ChildProcess;
  port: number;
  slug: string;
  serverId: string;
  pluginDir: string;
  entrypoint?: string;
}

export class PluginManager {
  private processes = new Map<string, RunningPlugin>();
  // Kept per slug across restarts. Holding it on the process entry lost it:
  // the entry is deleted when the child exits, before the restart reads it.
  private restartTimes = new Map<string, number[]>();
  private statuses = new Map<string, PluginStatus>();
  private db: Database;
  private pool: ConnectionPool;
  private userFor: PluginUserLookup;

  constructor(
    db: Database,
    pool: ConnectionPool,
    opts: { userFor?: PluginUserLookup } = {}
  ) {
    this.db = db;
    this.pool = pool;
    this.userFor = opts.userFor ?? imagePluginUser;
    mkdirSync(PLUGINS_DIR, { recursive: true });
  }

  async install(opts: {
    githubRepoUrl: string;
    slug?: string;
    envVars?: Record<string, string>;
    submittedByUserId?: string;
  }): Promise<{ id: string; slug: string }> {
    const { owner, name: repoName } = parseGithubUrl(opts.githubRepoUrl);
    const slug = opts.slug ?? repoName;

    if (!SLUG_PATTERN.test(slug)) {
      throw new Error(
        `Invalid slug "${slug}": must match ${SLUG_PATTERN}`
      );
    }

    // Insert DB record
    const [server] = await this.db
      .insert(mcpServers)
      .values({
        slug,
        name: repoName,
        description: null,
        githubRepoUrl: opts.githubRepoUrl,
        githubRepoOwner: owner,
        githubRepoName: repoName,
        status: "pending",
        submittedByUserId: opts.submittedByUserId ?? null,
      })
      .returning({ id: mcpServers.id, slug: mcpServers.slug });

    // Store env vars
    if (opts.envVars && Object.keys(opts.envVars).length > 0) {
      await this.db.insert(mcpServerEnvVars).values(
        Object.entries(opts.envVars).map(([key, value]) => ({
          mcpServerId: server.id,
          key,
          value,
        }))
      );
    }

    // Run the rest async so the API can return 202 immediately
    this.installAsync(server.id, slug, opts.githubRepoUrl).catch((err) => {
      console.error(`[plugin-manager] install failed for ${slug}:`, err);
    });

    return { id: server.id, slug };
  }

  /**
   * Each active plugin the manager was asked to start, `up` or `down`.
   * `down` means the manager is not going to start it again until the
   * gateway restarts: it hit the restart limit, it exited cleanly, or it
   * could not be started at all. `up` means started and not given up on; it
   * does not say the plugin is answering. Read by `/health`.
   */
  pluginStatus(): Record<string, PluginStatus> {
    return Object.fromEntries(
      [...this.statuses].sort(([a], [b]) => a.localeCompare(b))
    );
  }

  async uninstall(slug: string): Promise<void> {
    this.statuses.delete(slug);
    this.restartTimes.delete(slug);
    // Kill process if running
    const running = this.processes.get(slug);
    if (running) {
      running.process.kill("SIGTERM");
      this.processes.delete(slug);
    }

    // Remove from connection pool
    const [server] = await this.db
      .select({ id: mcpServers.id })
      .from(mcpServers)
      .where(eq(mcpServers.slug, slug))
      .limit(1);

    if (server) {
      await this.pool.removeServer(server.id);
      // Cascade deletes tools, env vars, plugin connections
      await this.db
        .delete(mcpServers)
        .where(eq(mcpServers.id, server.id));
    }

    // Remove plugin directory
    const pluginDir = join(PLUGINS_DIR, slug);
    if (existsSync(pluginDir)) {
      rmSync(pluginDir, { recursive: true, force: true });
    }
  }

  async startAll(): Promise<void> {
    const activeServers = await this.db
      .select({
        id: mcpServers.id,
        slug: mcpServers.slug,
        containerPort: mcpServers.containerPort,
      })
      .from(mcpServers)
      .where(eq(mcpServers.status, "active"));

    await Promise.all(
      activeServers.map(async (server) => {
        const pluginDir = join(PLUGINS_DIR, server.slug);
        if (!existsSync(pluginDir)) {
          console.warn(
            `[plugin-manager] plugin dir missing for ${server.slug}, skipping`
          );
          this.statuses.set(server.slug, "down");
          return;
        }

        try {
          await this.spawnPlugin(
            server.id,
            server.slug,
            pluginDir,
            server.containerPort
          );
          console.log(
            `[plugin-manager] started ${server.slug} on port ${server.containerPort}`
          );
        } catch (err) {
          console.error(
            `[plugin-manager] failed to start ${server.slug}:`,
            err
          );
          this.statuses.set(server.slug, "down");
        }
      })
    );
  }

  async stopAll(): Promise<void> {
    for (const [slug, running] of this.processes) {
      console.log(`[plugin-manager] stopping ${slug}`);
      running.process.kill("SIGTERM");
    }
    this.processes.clear();
  }

  private async installAsync(
    serverId: string,
    slug: string,
    githubRepoUrl: string
  ): Promise<void> {
    const pluginDir = join(PLUGINS_DIR, slug);

    try {
      // Clone
      console.log(`[plugin-manager] cloning ${githubRepoUrl}...`);
      if (existsSync(pluginDir)) {
        rmSync(pluginDir, { recursive: true, force: true });
      }
      execFileSync("git", ["clone", "--depth", "1", githubRepoUrl, pluginDir], {
        stdio: "pipe",
      });

      // Read manifest
      const manifestPath = join(pluginDir, "datatorag.json");
      let manifest: McpGatewayManifest | null = null;
      if (existsSync(manifestPath)) {
        manifest = JSON.parse(
          readFileSync(manifestPath, "utf-8")
        ) as McpGatewayManifest;
      }

      // Read package.json for fallback metadata
      const pkgPath = join(pluginDir, "package.json");
      let pkg: Record<string, unknown> = {};
      if (existsSync(pkgPath)) {
        pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      }

      const serverName = manifest?.name ?? (pkg.name as string) ?? slug;
      const serverDesc =
        manifest?.description ?? (pkg.description as string) ?? null;

      // Set status to building
      await this.db
        .update(mcpServers)
        .set({
          status: "building",
          name: serverName,
          description: serverDesc,
          manifestJson: manifest ?? null,
          updatedAt: new Date(),
        })
        .where(eq(mcpServers.id, serverId));

      // Install dependencies
      console.log(`[plugin-manager] installing deps for ${slug}...`);
      const usePnpm = existsSync(join(pluginDir, "pnpm-lock.yaml"));
      const pmBin = usePnpm ? "pnpm" : "npm";
      const installArgs = usePnpm
        ? ["install", "--frozen-lockfile"]
        : existsSync(join(pluginDir, "package-lock.json"))
          ? ["ci"]
          : ["install"];
      // Override NODE_ENV so npm installs devDependencies (e.g. typescript)
      const pluginEnv = { ...process.env, NODE_ENV: "development" as const };
      execFileSync(pmBin, installArgs, { cwd: pluginDir, stdio: "pipe", env: pluginEnv });

      // Build if build script exists
      if (pkg.scripts && (pkg.scripts as Record<string, string>).build) {
        console.log(`[plugin-manager] building ${slug}...`);
        execFileSync(pmBin, ["run", "build"], { cwd: pluginDir, stdio: "pipe", env: pluginEnv });
      }

      // Determine entrypoint from package.json before spawning
      let entrypoint = join("server", "index.js");
      if (pkg.scripts && (pkg.scripts as Record<string, string>).start) {
        const startScript = (pkg.scripts as Record<string, string>).start;
        entrypoint = parseEntrypointFromScript(startScript);
      } else if (pkg.main) {
        entrypoint = pkg.main as string;
      }

      // Assign port
      const port = await this.nextAvailablePort();
      await this.db
        .update(mcpServers)
        .set({ containerPort: port, updatedAt: new Date() })
        .where(eq(mcpServers.id, serverId));

      // Spawn process
      await this.spawnPlugin(serverId, slug, pluginDir, port, entrypoint);

      // Health check
      await this.waitForHealth(port);

      // Discover tools via MCP
      await this.discoverTools(serverId, slug, port);

      // Mark active
      await this.db
        .update(mcpServers)
        .set({ status: "active", buildError: null, updatedAt: new Date() })
        .where(eq(mcpServers.id, serverId));

      console.log(`[plugin-manager] ${slug} installed and active on port ${port}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[plugin-manager] install error for ${slug}:`, message);

      void sendSlack("alerts", {
        text: `🔴 Plugin build FAILED: ${slug}\n${message}`,
      });

      await this.db
        .update(mcpServers)
        .set({
          status: "error",
          buildError: message,
          updatedAt: new Date(),
        })
        .where(eq(mcpServers.id, serverId));

      // Kill process if it was spawned
      const running = this.processes.get(slug);
      if (running) {
        running.process.kill("SIGTERM");
        this.processes.delete(slug);
      }
    }
  }

  private async spawnPlugin(
    serverId: string,
    slug: string,
    pluginDir: string,
    port: number,
    entrypoint?: string
  ): Promise<void> {
    // Resolve env vars from DB
    const envRows = await this.db
      .select({ key: mcpServerEnvVars.key, value: mcpServerEnvVars.value })
      .from(mcpServerEnvVars)
      .where(eq(mcpServerEnvVars.mcpServerId, serverId));

    const { env: childEnv, refused } = buildPluginEnv(
      process.env,
      port,
      envRows
    );
    for (const line of refused) {
      console.error(
        `[plugin-manager] ${slug}: env row refused and left out (${line})`
      );
    }

    // Determine entrypoint (caller provides it during install; startAll reads from package.json)
    let resolvedEntrypoint = entrypoint ?? join("server", "index.js");
    if (!entrypoint) {
      const pkgPath = join(pluginDir, "package.json");
      if (existsSync(pkgPath)) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        if (pkg.scripts?.start) {
          resolvedEntrypoint = parseEntrypointFromScript(pkg.scripts.start as string);
        } else if (pkg.main) {
          resolvedEntrypoint = pkg.main;
        }
      }
    }

    const user = this.userFor(slug);
    if (user === null) {
      throw new Error(
        `no non-root account "${pluginUserName(slug)}" for this plugin, so it is not started`
      );
    }

    const child = spawn("node", [resolvedEntrypoint], {
      cwd: pluginDir,
      // Its own account when there is one. The operating system drops the
      // gateway's other groups along with the user.
      ...(user ? { uid: user.uid, gid: user.gid } : {}),
      // Next types NODE_ENV as always present; this one is exactly what
      // buildPluginEnv returned.
      env: childEnv as NodeJS.ProcessEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (data: Buffer) => {
      console.log(`[${slug}] ${data.toString().trimEnd()}`);
    });
    child.stderr?.on("data", (data: Buffer) => {
      console.error(`[${slug}] ${data.toString().trimEnd()}`);
    });

    child.on("exit", (code, signal) => {
      console.log(`[plugin-manager] ${slug} exited with code ${code} signal ${signal}`);
      // Only the child the manager currently holds for this slug is acted
      // on. One it already let go of (stopped, uninstalled) is not restarted
      // and cannot change the status of a replacement.
      if (this.processes.get(slug)?.process !== child) return;
      this.processes.delete(slug);

      // Auto-respawn if crash was unexpected (non-zero exit, not SIGTERM)
      if (code !== 0 && signal !== "SIGTERM") {
        const now = Date.now();
        const recentRestarts = (this.restartTimes.get(slug) ?? []).filter(
          (t) => now - t < RESPAWN_WINDOW_MS
        );

        if (recentRestarts.length < MAX_RESPAWNS) {
          recentRestarts.push(now);
          this.restartTimes.set(slug, recentRestarts);
          console.log(
            `[plugin-manager] respawning ${slug} (attempt ${recentRestarts.length}/${MAX_RESPAWNS})`
          );
          this.spawnPlugin(serverId, slug, pluginDir, port, entrypoint).catch(
            (err) => {
              console.error(`[plugin-manager] respawn failed for ${slug}:`, err);
              this.statuses.set(slug, "down");
            }
          );
        } else {
          this.restartTimes.set(slug, recentRestarts);
          this.statuses.set(slug, "down");
          console.error(
            `[plugin-manager] ${slug} crashed again after ${MAX_RESPAWNS} restarts in ${RESPAWN_WINDOW_MS / 1000}s, not restarting`
          );
        }
      } else {
        // A clean exit is not restarted either, so it is not up.
        this.statuses.set(slug, "down");
      }
    });

    this.processes.set(slug, {
      process: child,
      port,
      slug,
      serverId,
      pluginDir,
      entrypoint,
    });
    this.statuses.set(slug, "up");
  }

  private async waitForHealth(port: number): Promise<void> {
    const url = `http://localhost:${port}/health`;
    for (let i = 0; i < 5; i++) {
      try {
        const res = await fetch(url);
        if (res.ok) return;
      } catch {
        // Not ready yet
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error(`Health check failed after 5 attempts on port ${port}`);
  }

  private async discoverTools(
    serverId: string,
    slug: string,
    port: number
  ): Promise<void> {
    const serverUrl = `http://localhost:${port}/mcp`;
    const transport = new StreamableHTTPClientTransport(new URL(serverUrl));
    const client = new Client(
      { name: "datatorag-mcp", version: "0.1.0" },
      { capabilities: {} }
    );

    try {
      await client.connect(transport);
      const result = await client.listTools();

      if (result.tools.length > 0) {
        // Delete existing tools for this server (in case of reinstall)
        await this.db
          .delete(tools)
          .where(eq(tools.mcpServerId, serverId));

        await this.db.insert(tools).values(
          result.tools.map((t) => ({
            mcpServerId: serverId,
            name: t.name,
            namespacedName: `${slug}${NAMESPACE_SEPARATOR}${t.name}`,
            description: t.description ?? null,
            inputSchemaJson: t.inputSchema ?? null,
            // MCP annotation: readOnlyHint true = declared read-only, false =
            // declared mutating, undefined = unannotated (stored as null).
            //
            // Stored as the plugin's own claim, NOT as an input to the write
            // gate. The gate classifies by tool name and never reads this. We
            // keep it so a test can assert the plugin's declaration and our
            // classification agree; a plugin controls this value, so trusting
            // it would let a server opt its own delete tool out of approval.
            readOnlyHint: t.annotations?.readOnlyHint ?? null,
            creditsPerCall: 1,
          }))
        );

        console.log(
          `[plugin-manager] discovered ${result.tools.length} tools for ${slug}`
        );
      }
    } finally {
      await client.close();
    }
  }

  private async nextAvailablePort(): Promise<number> {
    const usedPorts = new Set(
      [...this.processes.values()].map((p) => p.port)
    );

    // Also check DB for ports assigned but maybe not currently running
    const dbServers = await this.db
      .select({ containerPort: mcpServers.containerPort })
      .from(mcpServers);
    for (const s of dbServers) {
      usedPorts.add(s.containerPort);
    }

    let port = BASE_PORT;
    while (usedPorts.has(port)) {
      port++;
    }

    // Verify the port is actually free on the OS
    while (!(await isPortFree(port))) {
      port++;
    }
    return port;
  }
}

function parseGithubUrl(url: string): { owner: string; name: string } {
  // Handle https://github.com/owner/repo or https://github.com/owner/repo.git
  const match = url.match(
    /github\.com[/:]([^/]+)\/([^/.]+)/
  );
  if (!match) {
    throw new Error(`Cannot parse GitHub URL: ${url}`);
  }
  return { owner: match[1], name: match[2] };
}

function parseEntrypointFromScript(script: string): string {
  // Extract the file argument from a node start script, skipping flags.
  // e.g. "node --max-old-space-size=4096 server.js" → "server.js"
  const parts = script.split(/\s+/);
  // Find the last part that looks like a file (not a flag, not "node")
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p !== "node" && !p.startsWith("-")) {
      return p;
    }
  }
  return script;
}

function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
  });
}
