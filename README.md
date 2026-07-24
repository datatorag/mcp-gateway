# DataToRAG MCP

**Connect your Google Workspace, Jira, and Confluence to Claude — through one MCP endpoint.**

DataToRAG is an open-source [Model Context Protocol](https://modelcontextprotocol.io) gateway that turns your everyday work tools into something your AI assistant can actually use. Gmail, Calendar, Drive, Docs, Sheets, Slides, Tasks, Contacts, Jira, and Confluence — 76 tools across one endpoint, with multi-account support and token-optimized responses.

- **Website** → [datatorag.com](https://datatorag.com)
- **Docs** → [datatorag.com/docs](https://datatorag.com/docs)
- **Dashboard** → [datatorag.com/dashboard](https://datatorag.com/dashboard)

---

## Why DataToRAG

**Works with any MCP client.** Claude Desktop, Cursor, Windsurf, custom agents — anything that speaks the Model Context Protocol.

**Google Workspace, natively.** 54 tools across Gmail, Calendar, Drive, Docs, Sheets, Slides, Contacts, and Tasks. Search threads, draft replies, automate inbox filters, update cells, batch-create slides, find files, manage tasks — from a single prompt.

**Atlassian, too.** 22 tools for Jira and Confluence: search by JQL or CQL, create and transition issues, read and edit pages, manage comments and attachments.

**Multi-account out of the box.** Connect personal, shared, and team Google accounts under one endpoint. Your assistant can target a specific account or search across all of them.

**Token-optimized.** Naive API wrappers dump everything into your context window. DataToRAG tunes tool responses for token efficiency — the same Gmail thread read costs a fraction of the tokens, which means longer conversations and smarter agents.

**OAuth per user.** Each user signs in with Google and Atlassian themselves. No shared service accounts, no tokens in code.

**Self-hostable.** MIT-licensed. Run it on your own infrastructure, or use the hosted version at datatorag.com.

---

## Quick Start (hosted)

Add this to your MCP client config:

```json
{
  "mcpServers": {
    "datatorag": {
      "url": "https://datatorag.com/mcp"
    }
  }
}
```

Then sign in at [datatorag.com/dashboard](https://datatorag.com/dashboard) and connect your Google or Atlassian accounts. That's it — your AI assistant now has access to every tool listed in the [docs](https://datatorag.com/docs).

---

## Available Connectors

| Connector | Tools | Services |
|-----------|-------|----------|
| [Google Workspace](https://datatorag.com/docs/google-workspace) | 54 | Gmail · Calendar · Drive · Docs · Sheets · Slides · Contacts · Tasks |
| [Atlassian](https://datatorag.com/docs/atlassian) | 22 | Jira · Confluence |

Each tool is documented with its operations, required OAuth scopes, and example prompts at [datatorag.com/docs](https://datatorag.com/docs).

Both connectors are themselves open-source MCP servers that plug into the gateway: [gws-mcp](https://github.com/datatorag/gws-mcp) and [atlassian-mcp](https://github.com/datatorag/atlassian-mcp).

---

## Architecture

```
              ┌──────────────────┐
              │    MCP Client    │
              │  Claude Desktop, │
              │   Cursor, etc.   │
              └────────┬─────────┘
                       │
             POST /mcp │  Bearer <OAuth token>
                       │
                       ▼
              ┌──────────────────┐
              │    1. Auth       │── OAuth2 token
              │                  │   validation
              └────────┬─────────┘   401 if invalid
                       │
                       ▼
              ┌──────────────────┐
              │   2. Session     │── Streamable HTTP
              │                  │   Create or reuse
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐    ┌────────────┐
              │  3. tools/list   │───>│ PostgreSQL │
              │     tools/call   │    │            │
              └────────┬─────────┘    │ users      │
                       │              │ tools      │
                       ▼              │ accounts   │
              ┌──────────────────┐    │            │
              │  4. Route by     │<──>│            │
              │     namespace    │    └────────────┘
              └────────┬─────────┘
                       │
          ┌────────────┼─────────────┐
          ▼            ▼             ▼
   ┌────────────┐ ┌────────────┐ ┌──────────┐
   │  gws-mcp   │ │ atlassian- │ │ plugin-n │
   │  (Node.js) │ │    mcp     │ │   ...    │
   │ :40000/mcp │ │ :40001/mcp │ │          │
   └────────────┘ └────────────┘ └──────────┘
```

The gateway is a thin routing layer: it authenticates the client, forwards per-user OAuth tokens to the plugin that owns the tool namespace, and streams the response back. Plugins run as separate Node.js processes — they can be added, removed, or replaced without changing the gateway.

---

## Self-Hosting

### Prerequisites

- Docker
- Google OAuth client for login (and a separate one for Google Workspace scopes)
- Atlassian OAuth client (optional, for Jira + Confluence)

### Local Development

```bash
# Start postgres, run migrations, seed a test user, and boot the gateway
docker compose -f docker/docker-compose.dev.yml up -d
```

| Service | URL |
|---------|-----|
| Gateway | http://localhost:8285 |
| Dashboard | http://localhost:8285/dashboard |
| Docs | http://localhost:8285/docs |
| Health | http://localhost:8285/health |
| OAuth metadata | http://localhost:8285/.well-known/oauth-authorization-server |

Connect a local MCP client:

```json
{
  "mcpServers": {
    "datatorag": {
      "url": "http://localhost:8285/mcp"
    }
  }
}
```

### Development Without Docker

```bash
# Start only postgres
docker compose -f docker/docker-compose.dev.yml up postgres -d

pnpm install

# Push schema + seed
DATABASE_URL=postgresql://datatoragmcp:localdev@localhost:54320/datatoragmcp \
  pnpm --filter @datatorag-mcp/db db:push && \
  pnpm --filter @datatorag-mcp/db db:seed

# Start gateway
DATABASE_URL=postgresql://datatoragmcp:localdev@localhost:54320/datatoragmcp \
  pnpm --filter @datatorag-mcp/gateway dev
```

### Environment Variables

| Variable | Default | Required | Description |
|----------|---------|----------|-------------|
| `DATABASE_URL` | — | Yes | PostgreSQL connection string |
| `GATEWAY_PORT` | `8285` | No | Gateway server port |
| `GATEWAY_BASE_URL` | `http://localhost:8285` | No | Public URL for OAuth redirects |
| `GOOGLE_CLIENT_ID` | — | For login | Google OAuth client ID (dashboard sign-in, minimal scopes) |
| `GOOGLE_CLIENT_SECRET` | — | For login | Google OAuth client secret |
| `GOOGLE_GWS_CLIENT_ID` | — | For GWS tools | Separate OAuth client for Google Workspace scopes |
| `GOOGLE_GWS_CLIENT_SECRET` | — | For GWS tools | — |
| `ATLASSIAN_CLIENT_ID` | — | For Atlassian tools | Atlassian OAuth client ID |
| `ATLASSIAN_CLIENT_SECRET` | — | For Atlassian tools | — |
| `POSTHOG_API_KEY` | — | No | PostHog project key for server-side analytics (tool calls, signups, OAuth) |
| `NEXT_PUBLIC_POSTHOG_KEY` | — | No | Same value as `POSTHOG_API_KEY`, exposed to the browser. Inlined at build time — must be set when running `next build` or `docker build`. PostHog project keys are safe to expose publicly. |

### Production Deployment

Production runs on Docker Compose with a build-arg pipeline for `NEXT_PUBLIC_*` values. See `docker/docker-compose.prod.yml` and `apps/gateway/Dockerfile` for the reference setup.

---

## Project Structure

```
apps/
  gateway/             MCP proxy server (Express + MCP SDK) + Next.js dashboard
    src/
      app/             Dashboard, docs, landing page (Next.js App Router)
      gateway/         MCP routing, auth, plugin manager, tool tracking
      lib/             Shared utilities (docs parser, analytics, hooks)
    content/
      blog/            Markdown blog posts
      docs/            Markdown connector docs
    server.ts          Custom Express server entry point
packages/
  config/              Environment variable parsing (zod schema)
  db/                  Drizzle ORM schema + database client
  types/               Shared TypeScript types
  auth/                OAuth helpers
docker/
  docker-compose.dev.yml    Local development stack
  docker-compose.prod.yml   Production (Lightsail)
```

---

## Contributing

Issues and pull requests welcome. For substantial changes, open an issue first so we can align on direction.

## License

MIT
