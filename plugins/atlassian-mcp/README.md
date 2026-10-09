# Atlassian MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for Jira and Confluence Cloud — search, issues, pages, comments, and attachments.

This server powers the Atlassian connector of [DataToRAG](https://datatorag.com), a hosted MCP gateway with per-user OAuth and Google Workspace tools alongside these — add `https://datatorag.com/mcp` to your MCP client and connect your Atlassian account from the [dashboard](https://datatorag.com/dashboard). Or run it yourself, standalone.

## Tools

| Service | Operations |
|---------|------------|
| **Jira** | search (JQL), get issue, create, update, **delete (permanent)**, transition, get transitions, list fields, search users, get/add/edit/delete comments, get attachment, add attachment (from a file reference) |
| **Confluence** | search (CQL), list pages, get page, create, edit, delete, get/add comments, get attachment |

### Key tool details

**jira_search** — Full [JQL](https://support.atlassian.com/jira-software-cloud/docs/use-advanced-search-with-jira-query-language-jql/) support with field selection and pagination.

**jira_create_issue / jira_update_issue** — Structured parameters for the common fields (project, type, summary, description, assignee, labels, priority), plus `additional_fields` for anything else the create/edit screens accept, including custom fields.

**jira_transition_issue** — Moves an issue through its workflow. Use `jira_get_transitions` first to see which transitions are available from the issue's current status.

**jira_delete_issue** — Permanently deletes an issue. There is no trash or archive and the key is never reused, so this is unrecoverable through the API and every link to the issue breaks. Transitioning to Done or Won't Do is almost always the right call instead. Deleting an issue that has subtasks fails unless `delete_subtasks` is true, which destroys them with it.

**jira_add_attachment** adds a file to an issue as an attachment. The file is named by a file reference (a Gmail message, attached as its original `.eml`, or one attachment of a message, named by its part id), so its bytes never pass through the conversation. The answer is a receipt: the attachment Jira stored, the sha256 and byte count of what was sent, and the issue and site it landed on. The issue is read before anything is uploaded, one file a call (several attachments are several calls), at most 25 MB, never retried. It only works behind a gateway that resolves the reference (see [The private file route](#the-private-file-route)); called on its own it answers an error and sends nothing.

**confluence_get_page / confluence_edit_page** — Read and write page bodies in Confluence storage format, with a `format` parameter on reads.

**confluence_search** — [CQL](https://developer.atlassian.com/cloud/confluence/advanced-searching-using-cql/) search across pages, blog posts, and comments.

## How authentication works

Each MCP session authenticates with a standard Atlassian OAuth 2.0 (3LO) access token passed in the `X-User-Token` HTTP header when the session is initialized. The server resolves the token's Atlassian cloud ID automatically (via `oauth/token/accessible-resources`) and targets that tenant for all Jira and Confluence calls.

There are no app credentials in this server — obtaining and refreshing user tokens is the caller's job. Under the DataToRAG gateway, that's handled by the gateway's per-user OAuth flow; standalone, you need to supply a valid access token yourself.

Scopes required (see `datatorag.json`): `read:jira-work`, `write:jira-work`, `read:jira-user`, `read:confluence-content.all`, `write:confluence-content`, `read:confluence-space.summary`, `offline_access`.

## Running standalone

```bash
pnpm install
pnpm run build
PORT=40001 pnpm run start
```

The server exposes `/mcp` (Streamable HTTP) and `/health` on the configured port. Initialize an MCP session with an `X-User-Token` header carrying the user's Atlassian access token:

```json
{
  "mcpServers": {
    "atlassian": {
      "type": "streamable-http",
      "url": "http://localhost:40001/mcp",
      "headers": {
        "X-User-Token": "<atlassian-oauth-access-token>"
      }
    }
  }
}
```

## The private file route

`POST /internal/consume` is how a gateway hands this server a file. It is not an MCP tool, it is not listed by `tools/list`, and no model calls it: only the gateway does, after it has resolved a file reference by fetching the bytes from another connector. The bytes go from the gateway to this server to Jira, held in memory and never written to disk.

| Part | Value |
|------|-------|
| `X-User-Token` | The user's Atlassian access token |
| `X-Tool-Name` | The tool the bytes are for. Today only `jira_add_attachment` |
| `X-Tool-Args` | base64url of the UTF-8 JSON of the tool's arguments (without the file's bytes) |
| `X-File-Name` | The file's name, `encodeURIComponent`-encoded |
| `X-File-Type` | The file's MIME type |
| Body | The raw bytes, `Content-Type: application/octet-stream`, at most 26214400 bytes |

A request the route cannot act on answers `{"error": "...", "code": "..."}`: 401 `no_token`, 400 `bad_request`, 404 `unknown_tool`, 413 `too_large`, 405 for anything but POST. Otherwise it answers 200 with an MCP tool result, `{"content": [{"type": "text", "text": "..."}], "isError": false}`. A failure of the tool itself (a bad issue key, Jira refusing the upload) is a 200 with `isError: true`, not an HTTP error.

The route is authenticated the same way `/mcp` is, by the user's token and nothing else, so keep the port reachable only from the gateway.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3000` | HTTP server port (the DataToRAG gateway's plugin manager sets this) |

## Architecture

```
src/
├── index.ts              # HTTP entry point (StreamableHTTP, /health + /mcp + /internal/consume)
├── create-server.ts      # MCP server factory (accepts optional per-session client)
├── atlassian-client.ts   # Atlassian REST client, cloud-ID resolution, token per call
├── internal/
│   └── consume.ts        # Private route: the gateway hands over a file's bytes for a tool
└── tools/
    ├── jira.ts           # Jira tool schemas + handler dispatch
    ├── confluence.ts     # Confluence tool schemas + handler dispatch
    └── response.ts       # Shared response helpers (JSON formatting, truncation)
```

`datatorag.json` is the plugin manifest the DataToRAG gateway reads: name, description, and the OAuth block (scopes plus the *names* of the client-credential env vars — never secret values).

### Key implementation details

- **Jira REST v3** for all Jira calls; **Confluence v2 API** for pages and comments, with the deprecated v1 API retained only for CQL search, which has no v2 equivalent
- **Cloud-ID resolution** happens once per client and is reused across calls
- **Space key resolution**: Confluence v2 endpoints require numeric space IDs; human-readable keys (like `ENG`) are resolved and cached per server process
- **Verbose tool schemas**: every tool documents its parameters in the description and carries `readOnlyHint`/`destructiveHint` annotations

## Development

```bash
pnpm run dev    # Watch mode — recompiles on change
```

`pnpm test` runs `tsc` in strict mode then the vitest suite, which pins tool annotations, the safety-critical bits of the destructive tools, and the attachment upload and its private route against a fake `fetch`. That is the floor, not the whole story: behaviour still gets a live smoke test against a real Atlassian site, recorded in the commit body.

## License

MIT
