import next from "next";
import express from "express";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./src/gateway/mcp-server";
import { ConnectionPool } from "./src/gateway/pool";
import { createDb, oauthAccessTokens } from "@datatorag-mcp/db";
import { getEnv } from "@datatorag-mcp/config";
import { createMetadataRouter } from "./src/gateway/oauth/metadata";
import { createRegisterRouter } from "./src/gateway/oauth/register";
import { createAuthorizeRouter } from "./src/gateway/oauth/authorize";
import { createTokenRouter } from "./src/gateway/oauth/token";
import { createRevokeRouter } from "./src/gateway/oauth/revoke";
import { createAuthRouter } from "./src/gateway/auth";
import { getPluginManager } from "./src/lib/plugin-manager";
import { liveTokenConditions } from "./src/lib/token-liveness";
import { shutdownPosthog } from "./src/gateway/track";
import cron from "node-cron";
import { runDailyRollup } from "./src/gateway/usage/rollup";
import { runDailyDigest } from "./src/gateway/digest";
import { runNoActivationFollowup } from "./src/gateway/lifecycle";

const dev = process.env.NODE_ENV !== "production";

async function main() {
  const nextApp = next({ dev });
  const handle = nextApp.getRequestHandler();
  await nextApp.prepare();

  const env = getEnv();
  const db = createDb(env.DATABASE_URL);
  const pool = new ConnectionPool();
  const baseUrl = env.GATEWAY_BASE_URL;

  // Initialize plugin manager and start all active plugins
  const pluginManager = getPluginManager(db, pool);
  await pluginManager.startAll();

  const rollupJob = cron.schedule(
    "0 2 * * *",
    () => {
      runDailyRollup(db).catch((err) =>
        console.error("[rollup] failed", err)
      );
    },
    { timezone: "UTC" }
  );

  // Daily business digest to Slack — 8:52am Pacific, pinned (survives DST)
  const digestJob = cron.schedule(
    "52 8 * * *",
    () => {
      runDailyDigest(db).catch((err) =>
        console.error("[digest] failed", err)
      );
    },
    { timezone: "America/Los_Angeles" }
  );

  // No-activation follow-up email — 9:15am Pacific (a normal send hour,
  // after the 8:52 digest so ops sees the day's numbers first)
  const followupJob = cron.schedule(
    "15 9 * * *",
    () => {
      runNoActivationFollowup(db).catch((err) =>
        console.error("[lifecycle] follow-up run failed", err)
      );
    },
    { timezone: "America/Los_Angeles" }
  );

  const shutdown = async () => {
    console.log("Shutting down...");
    rollupJob.stop();
    digestJob.stop();
    followupJob.stop();
    await pluginManager.stopAll();
    await pool.drain();
    await shutdownPosthog();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  const app = express();

  app.use(cookieParser());

  app.use("/oauth", express.json(), express.urlencoded({ extended: true }));
  app.use("/mcp", express.json());

  // Dashboard auth (Google login -> session cookie)
  app.use(
    createAuthRouter(db, {
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      gwsClientId: env.GOOGLE_GWS_CLIENT_ID,
      gwsClientSecret: env.GOOGLE_GWS_CLIENT_SECRET,
      atlassianClientId: env.ATLASSIAN_CLIENT_ID,
      atlassianClientSecret: env.ATLASSIAN_CLIENT_SECRET,
      baseUrl,
    })
  );

  // OAuth2 authorization server routes (MCP clients only)
  app.use(createMetadataRouter(baseUrl));
  app.use(createRegisterRouter(db));
  app.use(
    createAuthorizeRouter(db, {
      googleClientId: env.GOOGLE_CLIENT_ID,
      googleClientSecret: env.GOOGLE_CLIENT_SECRET,
      baseUrl,
    })
  );
  app.use(createTokenRouter(db));
  app.use(createRevokeRouter(db));

  // Session store
  const sessions = new Map<
    string,
    {
      server: ReturnType<typeof createMcpServer>;
      transport: StreamableHTTPServerTransport;
    }
  >();

  app.get("/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  /** Validate a Bearer token (OAuth access token). Returns userId if valid. */
  async function validateBearer(
    rawToken: string
  ): Promise<{ userId: string } | null> {
    const [token] = await db
      .select({ userId: oauthAccessTokens.userId })
      .from(oauthAccessTokens)
      .where(
        and(
          eq(oauthAccessTokens.token, rawToken),
          ...liveTokenConditions()
        )
      )
      .limit(1);

    if (!token) return null;

    return { userId: token.userId };
  }

  // MCP endpoint
  app.all("/mcp", async (req, res) => {
    const authHeader = req.headers.authorization;

    if (!authHeader?.startsWith("Bearer ")) {
      // Per MCP spec: return 401 with resource metadata URL
      res.status(401).json({
        error: "unauthorized",
        resource_metadata: `${baseUrl}/.well-known/oauth-authorization-server`,
      });
      return;
    }

    const rawToken = authHeader.slice(7);
    const auth = await validateBearer(rawToken);
    if (!auth) {
      res.status(401).json({ error: "Invalid or expired token" });
      return;
    }

    const sessionId = req.headers["mcp-session-id"] as string | undefined;

    // Existing session — route GET/DELETE/POST to the stored transport
    if (sessionId && sessions.has(sessionId)) {
      const session = sessions.get(sessionId)!;
      await session.transport.handleRequest(req, res, req.body);
      return;
    }

    // New session — only POST can initialize
    if (req.method === "POST") {
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, { server, transport });
        },
      });

      transport.onclose = () => {
        if (transport.sessionId) {
          sessions.delete(transport.sessionId);
        }
      };

      const server = createMcpServer(auth.userId, db, pool);
      await server.connect(transport);

      await transport.handleRequest(req, res, req.body);
      return;
    }

    res.status(400).json({ error: "Invalid or missing session" });
  });

  // Next.js handles all other routes (pages, API routes, static assets)
  app.all("/{*path}", (req, res) => {
    return handle(req, res);
  });

  const port = env.GATEWAY_PORT;
  app.listen(port, () => {
    console.log(`DataToRAG MCP listening on port ${port}`);
    console.log(
      `OAuth metadata: ${baseUrl}/.well-known/oauth-authorization-server`
    );
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
