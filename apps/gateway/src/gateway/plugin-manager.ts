import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { homedir } from "node:os";
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
import type { ConnectionPool } from "./pool.js";
import { sendSlack } from "@/lib/slack";

const PLUGINS_DIR = join(homedir(), ".datatorag", "plugins");
const BASE_PORT = 40000;
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export const NAMESPACE_SEPARATOR = "__";

const MAX_RESPAWNS = 3;
const RESPAWN_WINDOW_MS = 60_000;

interface RunningPlugin {
  process: ChildProcess;
  port: number;
  slug: string;
  serverId: string;
  pluginDir: string;
  entrypoint?: string;
  crashTimes: number[];
}

export class PluginManager {
  private processes = new Map<string, RunningPlugin>();
  private db: Database;
  private pool: ConnectionPool;

  constructor(db: Database, pool: ConnectionPool) {
    this.db = db;
    this.pool = pool;
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

  async uninstall(slug: string): Promise<void> {
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

    const resolvedEnv: Record<string, string> = { PORT: String(port) };
    for (const row of envRows) {
      resolvedEnv[row.key] = row.value.startsWith("$")
        ? process.env[row.value.slice(1)] ?? ""
        : row.value;
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

    const child = spawn("node", [resolvedEntrypoint], {
      cwd: pluginDir,
      env: { ...process.env, ...resolvedEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });

    child.stdout?.on("data", (data: Buffer) => {
      console.log(`[${slug}] ${data.toString().trimEnd()}`);
    });
    child.stderr?.on("data", (data: Buffer) => {
      console.error(`[${slug}] ${data.toString().trimEnd()}`);
    });

    const existing = this.processes.get(slug);
    const crashTimes = existing?.crashTimes ?? [];

    child.on("exit", (code, signal) => {
      console.log(`[plugin-manager] ${slug} exited with code ${code} signal ${signal}`);
      this.processes.delete(slug);

      // Auto-respawn if crash was unexpected (non-zero exit, not SIGTERM)
      if (code !== 0 && signal !== "SIGTERM") {
        const now = Date.now();
        const recentCrashes = crashTimes.filter(
          (t) => now - t < RESPAWN_WINDOW_MS
        );
        recentCrashes.push(now);

        if (recentCrashes.length <= MAX_RESPAWNS) {
          console.log(
            `[plugin-manager] respawning ${slug} (attempt ${recentCrashes.length}/${MAX_RESPAWNS})`
          );
          this.spawnPlugin(serverId, slug, pluginDir, port, entrypoint).catch(
            (err) =>
              console.error(`[plugin-manager] respawn failed for ${slug}:`, err)
          );
        } else {
          console.error(
            `[plugin-manager] ${slug} crashed ${MAX_RESPAWNS} times in ${RESPAWN_WINDOW_MS / 1000}s, not restarting`
          );
        }
      }
    });

    this.processes.set(slug, {
      process: child,
      port,
      slug,
      serverId,
      pluginDir,
      entrypoint,
      crashTimes,
    });
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
