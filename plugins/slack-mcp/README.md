# Slack MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for Slack: channels, message search, channel history and threads, people and files, reactions, and posting as the user.

This server is the Slack connector of [DataToRAG](https://datatorag.com), a hosted MCP gateway with per-user OAuth, alongside its Google Workspace, Atlassian and Notion connectors. It is offered to the gateway's admins only, for the company's own workspace.

## Tools

| Tool | What it does | Slack method |
|------|--------------|--------------|

### What the tools return

- **Channels by id or name.** Every `channel` argument takes a channel id or a `#name`. A name is resolved through `conversations.list`, archived channels included, and refused if more than one channel carries it, with the ids of each.
- **Mentions as names.** `<@U…>` and `<#C…|name>` come back as `@Display Name` and `#name`. Each person is looked up once per call.
- **Text trimmed per message** at 2,000 characters, with a marker that says how much was cut. A whole response stays under 900 KB.

## How authentication works

Each MCP session authenticates with the user's Slack user token, passed in the `X-User-Token` HTTP header when the session is initialized. There are no app credentials in this server: the DataToRAG gateway runs the OAuth flow (an internal Slack app, user scopes only, token rotation on), keeps and refreshes the tokens, and hands this server only the calling user's access token. A call with no token is refused before any request.

Slack answers most refusals with HTTP 200 and `{"ok": false, "error": "<code>"}`. A refused token (`invalid_auth`, `token_expired`, `token_revoked`) and `missing_scope` both come back as words saying Slack needs reconnecting.

## Rate limits

Slack's per-method tiers apply. A read refused for rate (HTTP 429, `ratelimited`) is sent again inside the call, at most three requests in all, and only when Slack's `Retry-After` asks for a short wait; otherwise the refusal comes back with the wait in words. A write is never sent twice: its refusal comes back at once, and a write that got no answer is reported as possibly landed. Gateway and proxy failures are never retried.

## Running it

This is a service plugin of the DataToRAG gateway, not a server to run on its own. The gateway starts it as a child process, sets `PORT`, and sends each user's Slack access token in the `X-User-Token` header when it opens a session. For development, from the repository root:

```bash
pnpm install
pnpm --filter @datatorag-mcp/slack-mcp run build
pnpm --filter @datatorag-mcp/slack-mcp run test
```

The process exposes `/mcp` (Streamable HTTP) and `/health` on its port.

## License

MIT
