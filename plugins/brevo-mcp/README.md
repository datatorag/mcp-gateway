# Brevo MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io/) server for Brevo: contacts and lists, email campaigns and their reports, transactional email from templates, and the transactional event log.

This server is the Brevo connector of [DataToRAG](https://datatorag.com), a hosted MCP gateway with per-user OAuth, alongside its Google Workspace, Atlassian and Notion connectors. It is offered for our own Brevo organisation first; the connection is made with Brevo's OAuth, never with a pasted API key.

## Tools

| Tool | What it does | Brevo endpoint |
|------|--------------|----------------|
| `account_get` | The account: company, plan, and the emails it can still send today | `GET /v3/account` |
| `contacts_search` | Contacts by Brevo's `equals` filter or change date, or one list's members | `GET /v3/contacts`, `GET /v3/contacts/lists/{id}/contacts` |
| `contact_get` | One contact by email or id, with its attributes and lists | `GET /v3/contacts/{identifier}` |
| `lists_get` | Contact lists with their subscriber counts, or one list | `GET /v3/contacts/lists` |
| `campaigns_list` | Email campaigns, without their HTML | `GET /v3/emailCampaigns` |
| `campaign_get` | One campaign and its report; its HTML only when asked, capped | `GET /v3/emailCampaigns/{id}` |
| `campaign_export_recipients` | Starts Brevo's export of a sent campaign's recipients | `POST /v3/emailCampaigns/{id}/exportRecipients` |
| `process_get` | A background export's status and the address of its file | `GET /v3/processes/{id}` |
| `email_stats` | Transactional email totals over a period | `GET /v3/smtp/statistics/aggregatedReport` |
| `templates_get` | Transactional templates, or one with its HTML when asked | `GET /v3/smtp/templates` |
| `email_log` | Transactional email events, newest first | `GET /v3/smtp/statistics/events` |
| `contact_create`, `contact_update` | A contact's attributes and lists | `POST`, `PUT /v3/contacts` |
| `list_members_update` | Add contacts to a list or take them off it | `POST /v3/contacts/lists/{id}/contacts/add`, `/remove` |
| `campaign_create`, `campaign_update` | A draft campaign's settings, body and lists | `POST`, `PUT /v3/emailCampaigns` |
| `campaign_send_test` | A test of a campaign to the addresses named | `POST /v3/emailCampaigns/{id}/sendTest` |
| `campaign_send` | Sends a campaign now or at a time, after checking the send limit | `POST /v3/emailCampaigns/{id}/sendNow`, `PUT` with `scheduledAt` |
| `campaign_set_status` | Suspend, back to draft, archive or unarchive a campaign | `PUT /v3/emailCampaigns/{id}/status` |
| `email_send` | A transactional email from a template | `POST /v3/smtp/email` |

## Sends cannot be recalled

`campaign_send`, `email_send` and `campaign_send_test` send email, and a sent email cannot be recalled. They are annotated `destructiveHint: true`. `campaign_send` reads the account's send limit first and sends nothing when the limit left is below the number of contacts the campaign's lists hold.

## Limits

Brevo counts API calls per account per hour, and below its Professional plan its campaign and account endpoints allow 100 calls an hour. A read refused for rate is retried only when Brevo's reset is a few seconds away; otherwise the tool answers at once with when the limit resets. A write is never retried.

## License

MIT
