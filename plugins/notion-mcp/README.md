# Notion MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for Notion: search, pages as markdown, databases and their rows, comments, and the people in a workspace. Read-only.

This server is the Notion connector of [DataToRAG](https://datatorag.com), a hosted MCP gateway with per-user OAuth, alongside its Google Workspace and Atlassian connectors.

## Tools

| Tool | What it does | Notion endpoint |
|------|--------------|-----------------|
| `notion_search` | Finds pages and data sources by title | `POST /v1/search` |
| `notion_get_page` | One page: properties as plain values, content as markdown | `GET /v1/pages/{id}`, `GET /v1/pages/{id}/markdown` |
| `notion_get_database` | A database, its data sources, and each one's property schema | `GET /v1/databases/{id}`, `GET /v1/data_sources/{id}` |
| `notion_query_data_source` | Rows of a data source, with a filter, sorts and a property allowlist | `POST /v1/data_sources/{id}/query` |
| `notion_get_comments` | Open comments on a page or block | `GET /v1/comments` |
| `notion_list_users` | People and bots in the workspace, one by id, or the connection's own bot (`"me"`) | `GET /v1/users`, `/v1/users/{id}`, `/v1/users/me` |

Every id argument takes a Notion id (with or without dashes) or a Notion URL that contains one.

### What the tools return

- **Properties as plain values.** A Notion property is a typed envelope; these tools return `{"Status": "Done", "Assignee": ["Test User"], "Due": "2026-10-20"}`. People come back as names (or ids when Notion gives no name), dates as a string or `{start, end}`, relations as ids, rollups unwrapped, and a property type this server does not know as Notion sent it.
- **Lists in one shape.** Every list tool returns `{results, has_more, next_cursor}`, the same with no results as with some. `next_cursor` is the `cursor` argument for the next page. Notion's page size caps at 100, and a full page comes back with `has_more: true`, never as the whole set.
- **Search matches titles.** Notion's search API matches titles, not page content, and Notion describes its index as not immediate and not guaranteed complete.

## How sharing works, and what "not found" means

A Notion connection sees only the pages that were shared with it. During the connect step the person connecting picks pages; a parent page brings every page under it. More can be added at any time without reconnecting: open the page in Notion, open the `•••` menu at the top right, choose **Connections**, and add the DataToRAG connection.

Notion answers a page that is not shared exactly as it answers a page that does not exist: `404 object_not_found` (observed). So when a tool says a page or database was not found, either is possible, and the error says how to share it. A page that is not shared also never appears in `notion_search`.

## How authentication works

Each MCP session authenticates with the user's Notion OAuth access token, passed in the `X-User-Token` HTTP header when the session is initialized. There are no app credentials in this server: the DataToRAG gateway runs the OAuth flow, keeps and refreshes the tokens, and hands this server only the calling user's access token. A call with no token is refused before any request.

Notion's OAuth has no scopes: what a connection can do is set once on the connection, and what it can see is the pages shared with it. If Notion refuses the token (`401 unauthorized`), the tool says the Notion connection needs reconnecting.

Every request pins `Notion-Version: 2026-03-11`, the version Notion's markdown endpoints require.

## Rate limits

Notion allows about three requests a second per connection in a workspace. A read refused for rate (`429`, or Notion's `529`) is sent again inside the call, at most three requests in all, and only when Notion's `Retry-After` asks for a short wait; otherwise the refusal comes back with the wait in words. Gateway and proxy failures are never retried.

## Running it

This is a service plugin of the DataToRAG gateway, not a server to run on its own. The gateway starts it as a child process, sets `PORT`, and sends each user's Notion access token in the `X-User-Token` header when it opens a session. For development, from the repository root:

```bash
pnpm install
pnpm --filter @datatorag-mcp/notion-mcp run build
pnpm --filter @datatorag-mcp/notion-mcp run test
```

The process exposes `/mcp` (Streamable HTTP) and `/health` on its port.

## License

MIT
