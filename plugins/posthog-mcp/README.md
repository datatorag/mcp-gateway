# PostHog MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for PostHog, read-only: one project's trends, web analytics and HogQL queries, saved insights and dashboards, events, people and error tracking issues.

This server is the PostHog connector of [DataToRAG](https://datatorag.com), a hosted MCP gateway with per-user OAuth, alongside its Google Workspace, Atlassian, Notion, Brevo and Slack connectors. It is offered to our own team first. The connection is made with PostHog's OAuth, using a client metadata document and PKCE, and is granted one project and no write access.

## Tools

| Tool | What it does | PostHog endpoint |
|------|--------------|------------------|
| `posthog_project_get` | The project: id, name, organization, timezone | `GET /api/projects/{id}/` |
| `posthog_trends_query` | A trend of one to five events over a range, optionally broken down | `POST /api/projects/{id}/query/` (`TrendsQuery`) |
| `posthog_hogql_query` | One HogQL `SELECT`, with a `LIMIT` of at most 1,000 rows | `POST /api/projects/{id}/query/` (`HogQLQuery`) |
| `posthog_insights_list` | Saved insights, with a name search | `GET /api/projects/{id}/insights/` |
| `posthog_insight_get` | One saved insight and its last result, at most 100 rows | `GET /api/projects/{id}/insights/{insight}/` |
| `posthog_events_list` | Recent events in a range, with up to 20 properties each | `POST /api/projects/{id}/query/` (HogQL on `events`) |
| `posthog_persons_search` | People by part of an email, name or distinct id | `GET /api/projects/{id}/persons/` |
| `posthog_dashboards_list` | Dashboards, with a name search | `GET /api/projects/{id}/dashboards/` |
| `posthog_error_issues_list` | Error tracking issues in a range, ranked | `POST /api/projects/{id}/query/` (`ErrorTrackingQuery`) |
| `posthog_web_overview` | Visitors, page views, sessions, duration and bounce rate | `POST /api/projects/{id}/query/` (`WebOverviewQuery`) |

Every range takes its end as well as its start, so a number does not move between two reads. Test accounts are left out by default, by the project's own filters.

## Limits

Every answer is shaped to named fields and capped in rows, and its text at 50,000 characters, saying what was left out. A session runs at most two requests at once, under PostHog's few queries at once per project. A refusal for rate is retried once when PostHog asks for a short wait, and otherwise answered at once with the wait in words.

## How it runs

The gateway hands each session three headers: the user's access token, the regional host (`https://us.posthog.com` or `https://eu.posthog.com`, nothing else), and the project the connection was granted. A session with a host or project it does not accept sends nothing.
