/**
 * The write tools (SCRUM-468).
 *
 * Three of them send email, and a sent email cannot be recalled:
 * `campaign_send`, `email_send` and `campaign_send_test`. They carry MUTATE,
 * and their descriptions open with what they do to whom. `campaign_send`
 * also reads the account's send limit first and sends nothing when the limit
 * left is below what the campaign could reach, because past the free plan's
 * daily cap Brevo delivers to part of a list and leaves the rest for a manual
 * requeue. There is no `confirm` argument: a model fills one in itself, so it
 * would prove nothing.
 */
import type { BrevoClient } from "../brevo-client.js";
import { MUTATE, WRITE, type ToolDef } from "./annotations.js";
import { int, optBool, optDateTime, optEnum, optInts, optStr, optStrings, str } from "./args.js";
import { jsonResponse } from "./response.js";

/** Brevo takes this many addresses on one add or remove; more go in batches the caller makes. */
const MAX_MEMBERS_PER_CALL = 150;
/** One transactional send reaches at most this many recipients here. */
const MAX_TRANSACTIONAL_TO = 50;

const SETTABLE_STATUSES = ["suspended", "draft", "archive", "darchive"] as const;

const CAMPAIGN_FIELDS = {
  name: { type: "string", description: "The campaign's name, which recipients do not see." },
  subject: { type: "string", description: "The subject line." },
  sender_email: { type: "string", description: "The sender's address; it must be a sender verified in Brevo." },
  sender_name: { type: "string", description: "The sender's name." },
  html_content: { type: "string", description: "The body as HTML, under 1 MB. Not with template_id." },
  template_id: { type: "integer", minimum: 1, description: "Use this Brevo template as the body. Not with html_content." },
  list_ids: { type: "array", items: { type: "integer", minimum: 1 }, description: "The lists the campaign goes to." },
  reply_to: { type: "string", description: "Where replies go." },
  preview_text: { type: "string", description: "The preview line shown after the subject." },
};

export const brevoWriteTools: ToolDef[] = [
  {
    name: "contact_create",
    description:
      "Creates a contact with an email address, optional attributes (FIRSTNAME, LASTNAME and the account's own) and the lists to put it on. With update_enabled, an existing contact with that address is updated instead.",
    inputSchema: {
      type: "object",
      properties: {
        email: { type: "string", description: "The contact's email address." },
        attributes: { type: "object", description: "Attribute names to values, as Brevo names them: {\"FIRSTNAME\": \"Jane\"}." },
        list_ids: { type: "array", items: { type: "integer", minimum: 1 }, description: "Lists to add the contact to." },
        update_enabled: { type: "boolean", description: "Update the contact if one with this address exists. Default false." },
      },
      required: ["email"],
      additionalProperties: false,
    },
    annotations: WRITE("Create a contact"),
  },
  {
    name: "contact_update",
    description:
      "Changes a contact, found by email address or Brevo contact id: its attributes, lists to add it to, lists to take it off.",
    inputSchema: {
      type: "object",
      properties: {
        identifier: { type: "string", description: "The contact's email address or Brevo contact id." },
        attributes: { type: "object", description: "Attribute names to new values." },
        list_ids: { type: "array", items: { type: "integer", minimum: 1 }, description: "Lists to add the contact to." },
        unlink_list_ids: { type: "array", items: { type: "integer", minimum: 1 }, description: "Lists to take the contact off." },
      },
      required: ["identifier"],
      additionalProperties: false,
    },
    annotations: WRITE("Update a contact"),
  },
  {
    name: "list_members_update",
    description: `Adds contacts to a list, takes them off it, or both, by email address, at most ${MAX_MEMBERS_PER_CALL} each way per call.`,
    inputSchema: {
      type: "object",
      properties: {
        list_id: { type: "integer", minimum: 1, description: "The list." },
        add: { type: "array", items: { type: "string" }, description: "Email addresses to add." },
        remove: { type: "array", items: { type: "string" }, description: "Email addresses to take off." },
      },
      required: ["list_id"],
      additionalProperties: false,
    },
    annotations: WRITE("Change a list's members"),
  },
  {
    name: "campaign_create",
    description:
      "Creates an email campaign as a draft: name, subject, sender, a body (HTML or a template) and the lists it goes to. Nothing is sent; campaign_send_test sends a test and campaign_send sends it.",
    inputSchema: {
      type: "object",
      properties: CAMPAIGN_FIELDS,
      required: ["name", "subject", "sender_email", "list_ids"],
      additionalProperties: false,
    },
    annotations: WRITE("Create an email campaign"),
  },
  {
    name: "campaign_update",
    description:
      "Changes a draft or scheduled email campaign: any of its name, subject, sender, body, lists, reply-to and preview text. Scheduling is not here; it is campaign_send with scheduled_at.",
    inputSchema: {
      type: "object",
      properties: { campaign_id: { type: "integer", minimum: 1, description: "The campaign's id." }, ...CAMPAIGN_FIELDS },
      required: ["campaign_id"],
      additionalProperties: false,
    },
    annotations: WRITE("Update an email campaign"),
  },
  {
    name: "campaign_send_test",
    description:
      "Sends a test of an email campaign to the addresses named, and to no one else. A sent test cannot be recalled. Brevo allows fifty tests a day.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "integer", minimum: 1, description: "The campaign's id." },
        emails: { type: "array", items: { type: "string" }, description: "Where the test goes." },
      },
      required: ["campaign_id", "emails"],
      additionalProperties: false,
    },
    annotations: MUTATE("Send a test of an email campaign"),
  },
  {
    name: "campaign_send",
    description:
      "Sends an email campaign to every recipient on its lists, now, or at scheduled_at. A sent campaign cannot be recalled; a scheduled one can be stopped with campaign_set_status suspended. It first reads the account's send limit, and sends nothing when the limit left is below the number of contacts the campaign's lists hold, answering with both numbers.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "integer", minimum: 1, description: "The campaign's id." },
        scheduled_at: { type: "string", description: "Send at this ISO date and time instead of now, e.g. 2026-11-02T09:00:00Z." },
      },
      required: ["campaign_id"],
      additionalProperties: false,
    },
    annotations: MUTATE("Send an email campaign"),
  },
  {
    name: "campaign_set_status",
    description:
      "Sets an email campaign's status: suspended stops a scheduled campaign from sending, draft takes it back to a draft, archive and darchive archive and unarchive it.",
    inputSchema: {
      type: "object",
      properties: {
        campaign_id: { type: "integer", minimum: 1, description: "The campaign's id." },
        status: { type: "string", enum: [...SETTABLE_STATUSES], description: "The new status." },
      },
      required: ["campaign_id", "status"],
      additionalProperties: false,
    },
    annotations: WRITE("Set an email campaign's status"),
  },
  {
    name: "email_send",
    description: `Sends a transactional email from a Brevo template to the recipients named (at most ${MAX_TRANSACTIONAL_TO}), now or at scheduled_at, with params filling the template's placeholders. A sent email cannot be recalled.`,
    inputSchema: {
      type: "object",
      properties: {
        template_id: { type: "integer", minimum: 1, description: "The template to send." },
        to: {
          type: "array",
          items: { type: "object", properties: { email: { type: "string" }, name: { type: "string" } }, required: ["email"] },
          description: "The recipients.",
        },
        params: { type: "object", description: "Values for the template's {{ params.NAME }} placeholders." },
        scheduled_at: { type: "string", description: "Send at this ISO date and time instead of now." },
        tags: { type: "array", items: { type: "string" }, description: "Tags to find the email by in email_log and email_stats." },
      },
      required: ["template_id", "to"],
      additionalProperties: false,
    },
    annotations: MUTATE("Send a transactional email"),
  },
];

type Rec = Record<string, unknown>;

function optObject(args: Rec, name: string): Rec | undefined {
  const v = args[name];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== "object" || Array.isArray(v)) throw new Error(`${name} must be an object of names to values.`);
  return v as Rec;
}

/** The campaign body Brevo takes, from the tool's flat fields. */
function campaignBody(args: Rec, create: boolean): Rec {
  if ("scheduled_at" in args) throw new Error("Scheduling is a send: use campaign_send with scheduled_at.");
  const html = optStr(args, "html_content");
  const templateId = args.template_id === undefined ? undefined : int(args, "template_id");
  if (html !== undefined && templateId !== undefined) throw new Error("Give html_content or template_id, not both.");
  if (create && html === undefined && templateId === undefined) throw new Error("A campaign needs a body: html_content or template_id.");
  const senderEmail = optStr(args, "sender_email");
  const senderName = optStr(args, "sender_name");
  if (senderName !== undefined && senderEmail === undefined) throw new Error("sender_name goes with sender_email.");
  const listIds = optInts(args, "list_ids");
  const body: Rec = {
    name: optStr(args, "name"),
    subject: optStr(args, "subject"),
    sender: senderEmail ? { email: senderEmail, ...(senderName ? { name: senderName } : {}) } : undefined,
    htmlContent: html,
    templateId,
    recipients: listIds ? { listIds } : undefined,
    replyTo: optStr(args, "reply_to"),
    previewText: optStr(args, "preview_text"),
  };
  for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
  if (!create && Object.keys(body).length === 0) throw new Error("Nothing to change: give at least one field.");
  return body;
}

/** What `campaign_send` checks first: the contacts the campaign's lists hold,
 * at most (a contact on two lists counts twice, and exclusion lists are not
 * subtracted), and the account's send limit left, when it has one. */
async function sendCheck(client: BrevoClient, campaignId: number) {
  const campaign = (await client.request("GET", "/emailCampaigns/{campaignId}", {
    params: { campaignId },
    query: { excludeHtmlContent: true },
  })) as { recipients?: { lists?: number[] } };
  const listIds = campaign.recipients?.lists ?? [];
  let reach = 0;
  for (const listId of listIds) {
    const list = (await client.request("GET", "/contacts/lists/{listId}", { params: { listId } })) as { totalSubscribers?: number };
    reach += list.totalSubscribers ?? 0;
  }
  const account = (await client.request("GET", "/account")) as { plan?: Array<{ creditsType?: string; credits?: number }> };
  const limit = (account.plan ?? []).find((p) => p.creditsType === "sendLimit");
  return { reach, limitLeft: typeof limit?.credits === "number" ? limit.credits : null };
}

export async function handleBrevoWrite(client: BrevoClient, name: string, args: Rec) {
  switch (name) {
    case "contact_create": {
      const body: Rec = {
        email: str(args, "email"),
        attributes: optObject(args, "attributes"),
        listIds: optInts(args, "list_ids"),
        updateEnabled: optBool(args, "update_enabled"),
      };
      for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
      return jsonResponse(await client.request("POST", "/contacts", { body }));
    }

    case "contact_update": {
      const body: Rec = {
        attributes: optObject(args, "attributes"),
        listIds: optInts(args, "list_ids"),
        unlinkListIds: optInts(args, "unlink_list_ids"),
      };
      for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
      if (Object.keys(body).length === 0) throw new Error("Nothing to change: give attributes, list_ids or unlink_list_ids.");
      await client.request("PUT", "/contacts/{identifier}", { params: { identifier: str(args, "identifier") }, body });
      return jsonResponse({ updated: true });
    }

    case "list_members_update": {
      const listId = int(args, "list_id");
      const add = optStrings(args, "add");
      const remove = optStrings(args, "remove");
      if (!add && !remove) throw new Error("Give add, remove, or both.");
      for (const [label, emails] of [["add", add], ["remove", remove]] as const) {
        if (emails && emails.length > MAX_MEMBERS_PER_CALL) throw new Error(`${label} holds ${emails.length} addresses; at most ${MAX_MEMBERS_PER_CALL} per call.`);
      }
      const result: Rec = {};
      if (add) result.added = await client.request("POST", "/contacts/lists/{listId}/contacts/add", { params: { listId }, body: { emails: add } });
      if (remove) result.removed = await client.request("POST", "/contacts/lists/{listId}/contacts/remove", { params: { listId }, body: { emails: remove } });
      return jsonResponse(result);
    }

    case "campaign_create":
      for (const required of ["name", "subject", "sender_email"]) str(args, required);
      if (!optInts(args, "list_ids")) throw new Error("list_ids is required: the lists the campaign goes to.");
      return jsonResponse(await client.request("POST", "/emailCampaigns", { body: campaignBody(args, true) }));

    case "campaign_update": {
      const campaignId = int(args, "campaign_id");
      const rest = { ...args };
      delete rest.campaign_id;
      await client.request("PUT", "/emailCampaigns/{campaignId}", { params: { campaignId }, body: campaignBody(rest, false) });
      return jsonResponse({ updated: true });
    }

    case "campaign_send_test": {
      const emails = optStrings(args, "emails");
      if (!emails) throw new Error("emails is required: where the test goes.");
      await client.request("POST", "/emailCampaigns/{campaignId}/sendTest", { params: { campaignId: int(args, "campaign_id") }, body: { emailTo: emails } });
      return jsonResponse({ test_sent_to: emails });
    }

    case "campaign_send": {
      const campaignId = int(args, "campaign_id");
      const scheduledAt = optDateTime(args, "scheduled_at");
      const { reach, limitLeft } = await sendCheck(client, campaignId);
      if (limitLeft !== null && limitLeft < reach) {
        throw new Error(
          `Nothing was sent. Campaign ${campaignId}'s lists hold up to ${reach} contacts, and the account can send ${limitLeft} more emails today. Past the limit Brevo would reach only part of the lists and leave the rest for a manual requeue.`
        );
      }
      if (scheduledAt) {
        await client.request("PUT", "/emailCampaigns/{campaignId}", { params: { campaignId }, body: { scheduledAt } });
      } else {
        await client.request("POST", "/emailCampaigns/{campaignId}/sendNow", { params: { campaignId } });
      }
      return jsonResponse({
        campaign_id: campaignId,
        [scheduledAt ? "scheduled_at" : "sent"]: scheduledAt ?? true,
        lists_hold_up_to: reach,
        send_limit_left_before: limitLeft,
      });
    }

    case "campaign_set_status": {
      const status = optEnum(args, "status", SETTABLE_STATUSES);
      if (!status) throw new Error(`status is required: one of ${SETTABLE_STATUSES.join(", ")}.`);
      await client.request("PUT", "/emailCampaigns/{campaignId}/status", { params: { campaignId: int(args, "campaign_id") }, body: { status } });
      return jsonResponse({ status });
    }

    case "email_send": {
      const to = args.to;
      if (!Array.isArray(to) || to.length === 0 || to.some((r) => !r || typeof (r as Rec).email !== "string")) {
        throw new Error("to is required: a list of {email, name?} recipients.");
      }
      if (to.length > MAX_TRANSACTIONAL_TO) throw new Error(`to holds ${to.length} recipients; at most ${MAX_TRANSACTIONAL_TO} per send.`);
      const body: Rec = {
        templateId: int(args, "template_id"),
        to: (to as Rec[]).map((r) => ({ email: String(r.email), ...(typeof r.name === "string" ? { name: r.name } : {}) })),
        params: optObject(args, "params"),
        scheduledAt: optDateTime(args, "scheduled_at"),
        tags: optStrings(args, "tags"),
      };
      for (const k of Object.keys(body)) if (body[k] === undefined) delete body[k];
      return jsonResponse(await client.request("POST", "/smtp/email", { body }));
    }

    default:
      throw new Error(`Unknown write tool: ${name}`);
  }
}
