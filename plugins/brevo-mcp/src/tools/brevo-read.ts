/**
 * The read tools (SCRUM-468): one Brevo call each, nothing changed anywhere.
 *
 * Two of Brevo's answers are too large to hand back whole, and are cut here:
 * campaign and template HTML (returned only when asked, and capped), and
 * Brevo's event log, whose default page is 2,500 events (capped at 100 a
 * page). A recipients export is a file Brevo hosts; the tools hand back its
 * address, never its bytes.
 */
import type { BrevoClient } from "../brevo-client.js";
import { READ, type ToolDef } from "./annotations.js";
import { dateRange, int, optBool, optDateTime, optEnum, optInt, optStr, str } from "./args.js";
import { jsonResponse, truncate } from "./response.js";

/** HTML handed back when asked for it, unless the call names its own cap. */
const DEFAULT_HTML_CHARS = 20_000;
const MAX_HTML_CHARS = 200_000;

const PAGE = (max: number, dflt: number) => ({
  limit: { type: "integer", minimum: 1, maximum: max, description: `How many to return, at most ${max}. Default ${dflt}.` },
  offset: { type: "integer", minimum: 0, description: "How many to skip, to page through. Default 0." },
});

const HTML_ARGS = {
  include_html: { type: "boolean", description: "Also return the HTML body. Off by default, because it is large." },
  max_html_chars: {
    type: "integer",
    minimum: 1,
    maximum: MAX_HTML_CHARS,
    description: `Cut the HTML at this many characters, saying how much was left out. Default ${DEFAULT_HTML_CHARS}.`,
  },
};

const CAMPAIGN_STATUSES = ["draft", "sent", "archive", "queued", "suspended", "inProcess"] as const;
const CAMPAIGN_STATISTICS = ["globalStats", "linksStats", "statsByDomain", "statsByDevice", "statsByBrowser"] as const;
const RECIPIENT_TYPES = ["all", "nonClickers", "nonOpeners", "clickers", "openers", "softBounces", "hardBounces", "unsubscribed"] as const;
const EMAIL_EVENTS = [
  "bounces", "hardBounces", "softBounces", "delivered", "spam", "requests", "opened", "clicks",
  "invalid", "deferred", "blocked", "unsubscribed", "error", "loadedByProxy",
] as const;

export const brevoReadTools: ToolDef[] = [
  {
    name: "account_get",
    description:
      "The connected Brevo account: its company, its plan, and its credits, including how many emails it can still send today. Read this before a send to know the limit left.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: READ("Get the Brevo account"),
  },
  {
    name: "contacts_search",
    description:
      "Finds contacts, or lists the members of one list when list_id is given. filter takes Brevo's one operator, equals, on a contact attribute: equals(FIRSTNAME,\"Jane\"). modified_since and created_since take an ISO date and time.",
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "integer", minimum: 1, description: "Only the members of this list." },
        filter: { type: "string", description: "equals(ATTRIBUTE,\"value\"), Brevo's only filter. Not with list_id." },
        modified_since: { type: "string", description: "Only contacts changed since this ISO date and time." },
        created_since: { type: "string", description: "Only contacts created since this ISO date and time. Not with list_id." },
        ...PAGE(100, 50),
      },
      additionalProperties: false,
    },
    annotations: READ("Search contacts"),
  },
  {
    name: "contact_get",
    description:
      "One contact by email address or Brevo contact id: its attributes and the lists it is on. Its per-campaign statistics only with include_stats.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "The contact's email address or Brevo contact id." },
        include_stats: { type: "boolean", description: "Also return what the contact did with each campaign. Off by default." },
      },
      required: ["identifier"],
      additionalProperties: false,
    },
    annotations: READ("Get a contact"),
  },
  {
    name: "lists_get",
    description: "Contact lists with how many subscribers each has, or one list when list_id is given.",
    inputSchema: {
      type: "object",
      properties: { list_id: { type: "integer", minimum: 1, description: "One list." }, ...PAGE(50, 10) },
      additionalProperties: false,
    },
    annotations: READ("Get contact lists"),
  },
  {
    name: "campaigns_list",
    description: "Email campaigns, without their HTML. Use campaign_get for one campaign's body and report.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: [...CAMPAIGN_STATUSES], description: "Only campaigns in this status." },
        ...PAGE(100, 50),
      },
      additionalProperties: false,
    },
    annotations: READ("List email campaigns"),
  },
  {
    name: "campaign_get",
    description:
      "One email campaign: its settings, recipients and status, and its report when statistics is given (globalStats for the totals, or linksStats, statsByDomain, statsByDevice, statsByBrowser). Its HTML only with include_html, capped.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "integer", minimum: 1, description: "The campaign's id." },
        statistics: { type: "string", enum: [...CAMPAIGN_STATISTICS], description: "Which report to include." },
        ...HTML_ARGS,
      },
      required: ["campaign_id"],
      additionalProperties: false,
    },
    annotations: READ("Get an email campaign"),
  },
  {
    name: "campaign_export_recipients",
    description:
      "Starts Brevo's export of a sent campaign's recipients of one kind (all, openers, clickers, bounces, unsubscribed and so on) and answers with a process id. Brevo builds the file in the background; process_get says when it is ready and where Brevo has put it. Changes nothing.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "integer", minimum: 1, description: "The campaign's id." },
        recipients_type: { type: "string", enum: [...RECIPIENT_TYPES], description: "Which recipients to export." },
      },
      required: ["campaign_id", "recipients_type"],
      additionalProperties: false,
    },
    annotations: READ("Export a campaign's recipients"),
  },
  {
    name: "process_get",
    description: "A Brevo background process, such as a recipients export: its status and, when it is done, the address of the file Brevo built.",
    inputSchema: {
      type: "object",
      properties: { process_id: { type: "integer", minimum: 1, description: "The id campaign_export_recipients answered with." } },
      required: ["process_id"],
      additionalProperties: false,
    },
    annotations: READ("Get a Brevo process"),
  },
  {
    name: "email_stats",
    description:
      "Transactional email totals over a period: requests, delivered, opens, clicks, bounces, spam reports, unsubscribes. Give days (up to 90), or start_date and end_date; the default is Brevo's. A campaign's own numbers are campaign_get with statistics.",
    inputSchema: {
      type: "object",
      properties: {
        days: { type: "integer", minimum: 1, maximum: 90, description: "The last this many days." },
        start_date: { type: "string", description: "YYYY-MM-DD, with end_date." },
        end_date: { type: "string", description: "YYYY-MM-DD, with start_date." },
        tag: { type: "string", description: "Only emails sent with this tag." },
      },
      additionalProperties: false,
    },
    annotations: READ("Get transactional email statistics"),
  },
  {
    name: "templates_get",
    description:
      "Transactional email templates without their HTML, or one template when template_id is given, its HTML only with include_html, capped.",
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "integer", minimum: 1, description: "One template." },
        active_only: { type: "boolean", description: "Only active templates. Not with template_id." },
        ...HTML_ARGS,
        ...PAGE(100, 50),
      },
      additionalProperties: false,
    },
    annotations: READ("Get transactional templates"),
  },
  {
    name: "email_log",
    description:
      "What happened to transactional emails, event by event, newest first: delivered, opened, clicked, bounced and so on. Narrow by email, event, template_id or message_id, and by days (up to 90) or start_date and end_date.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "Only events for this recipient address." },
        event: { type: "string", enum: [...EMAIL_EVENTS], description: "Only this kind of event." },
        template_id: { type: "integer", minimum: 1, description: "Only emails sent from this template." },
        message_id: { type: "string", description: "Only this email." },
        days: { type: "integer", minimum: 1, maximum: 90, description: "The last this many days." },
        start_date: { type: "string", description: "YYYY-MM-DD, with end_date." },
        end_date: { type: "string", description: "YYYY-MM-DD, with start_date." },
        ...PAGE(100, 50),
      },
      additionalProperties: false,
    },
    annotations: READ("Get the transactional email log"),
  },
];

type Rec = Record<string, unknown>;

/** HTML cut to the cap the call asked for, saying how much was left out. */
function capHtml(html: unknown, args: Rec): unknown {
  if (typeof html !== "string") return html;
  return truncate(html, optInt(args, "max_html_chars", 1, MAX_HTML_CHARS) ?? DEFAULT_HTML_CHARS);
}

function page(args: Rec, max: number, dflt: number) {
  return { limit: optInt(args, "limit", 1, max) ?? dflt, offset: optInt(args, "offset", 0, Number.MAX_SAFE_INTEGER) ?? 0 };
}

export async function handleBrevoRead(client: BrevoClient, name: string, args: Rec) {
  switch (name) {
    case "account_get":
      return jsonResponse(await client.request("GET", "/account"));

    case "contacts_search": {
      const listId = optInt(args, "list_id", 1, Number.MAX_SAFE_INTEGER);
      const filter = optStr(args, "filter");
      const createdSince = optDateTime(args, "created_since");
      const modifiedSince = optDateTime(args, "modified_since");
      const { limit, offset } = page(args, 100, 50);
      if (listId !== undefined) {
        if (filter || createdSince) throw new Error("filter and created_since do not go with list_id; Brevo lists a list's members by modified_since only.");
        return jsonResponse(
          await client.request("GET", "/contacts/lists/{listId}/contacts", { params: { listId }, query: { limit, offset, modifiedSince } })
        );
      }
      return jsonResponse(await client.request("GET", "/contacts", { query: { limit, offset, filter, createdSince, modifiedSince } }));
    }

    case "contact_get": {
      const contact = (await client.request("GET", "/contacts/{identifier}", { params: { identifier: str(args, "identifier") } })) as Rec;
      if (optBool(args, "include_stats") !== true) delete contact.statistics;
      return jsonResponse(contact);
    }

    case "lists_get": {
      const listId = optInt(args, "list_id", 1, Number.MAX_SAFE_INTEGER);
      if (listId !== undefined) return jsonResponse(await client.request("GET", "/contacts/lists/{listId}", { params: { listId } }));
      return jsonResponse(await client.request("GET", "/contacts/lists", { query: page(args, 50, 10) }));
    }

    case "campaigns_list": {
      const status = optEnum(args, "status", CAMPAIGN_STATUSES);
      return jsonResponse(
        await client.request("GET", "/emailCampaigns", { query: { excludeHtmlContent: true, status, ...page(args, 100, 50) } })
      );
    }

    case "campaign_get": {
      const includeHtml = optBool(args, "include_html") === true;
      const campaign = (await client.request("GET", "/emailCampaigns/{campaignId}", {
        params: { campaignId: int(args, "campaign_id") },
        query: { statistics: optEnum(args, "statistics", CAMPAIGN_STATISTICS), excludeHtmlContent: !includeHtml },
      })) as Rec;
      if (includeHtml) campaign.htmlContent = capHtml(campaign.htmlContent, args);
      else delete campaign.htmlContent;
      return jsonResponse(campaign);
    }

    case "campaign_export_recipients": {
      const recipientsType = optEnum(args, "recipients_type", RECIPIENT_TYPES);
      if (recipientsType === undefined) throw new Error(`recipients_type is required: one of ${RECIPIENT_TYPES.join(", ")}.`);
      const started = (await client.request("POST", "/emailCampaigns/{campaignId}/exportRecipients", {
        params: { campaignId: int(args, "campaign_id") },
        body: { recipientsType },
      })) as Rec;
      return jsonResponse({ process_id: started.processId, next: "process_get with this process_id says when the file is ready" });
    }

    case "process_get":
      return jsonResponse(await client.request("GET", "/processes/{processId}", { params: { processId: int(args, "process_id") } }));

    case "email_stats": {
      const { days, startDate, endDate } = dateRange(args, 90);
      return jsonResponse(
        await client.request("GET", "/smtp/statistics/aggregatedReport", { query: { days, startDate, endDate, tag: optStr(args, "tag") } })
      );
    }

    case "templates_get": {
      const templateId = optInt(args, "template_id", 1, Number.MAX_SAFE_INTEGER);
      if (templateId !== undefined) {
        const template = (await client.request("GET", "/smtp/templates/{templateId}", { params: { templateId } })) as Rec;
        if (optBool(args, "include_html") === true) template.htmlContent = capHtml(template.htmlContent, args);
        else delete template.htmlContent;
        return jsonResponse(template);
      }
      if (optBool(args, "include_html") === true) throw new Error("include_html needs a template_id; a list of templates never carries their HTML.");
      const list = (await client.request("GET", "/smtp/templates", {
        query: { templateStatus: optBool(args, "active_only"), ...page(args, 100, 50) },
      })) as { templates?: Rec[] };
      // Brevo returns each template's HTML in a list, with no flag to leave it out.
      for (const t of list.templates ?? []) delete t.htmlContent;
      return jsonResponse(list);
    }

    case "email_log": {
      const { days, startDate, endDate } = dateRange(args, 90);
      return jsonResponse(
        await client.request("GET", "/smtp/statistics/events", {
          query: {
            email: optStr(args, "email"),
            event: optEnum(args, "event", EMAIL_EVENTS),
            templateId: optInt(args, "template_id", 1, Number.MAX_SAFE_INTEGER),
            messageId: optStr(args, "message_id"),
            days,
            startDate,
            endDate,
            ...page(args, 100, 50),
            sort: "desc",
          },
        })
      );
    }

    default:
      throw new Error(`Unknown read tool: ${name}`);
  }
}
