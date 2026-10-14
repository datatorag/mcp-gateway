import type { GwsClient } from "../gws-client.js";
import { MUTATE, ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";
import { unwrapJsonString } from "./validate.js";
import { repeatedParams } from "../google-api/request.js";

export const genericTools: ToolDef[] = [
  {
    name: "gws_run",
    description:
      "FALLBACK ONLY — use dedicated tools first (gmail_*, calendar_*, drive_*, sheets_*, docs_*, slides_*, contacts_*). Only use gws_run when no dedicated tool exists for the operation, e.g. Chat, Admin, Tasks, or advanced API calls not covered by other tools. Commands follow the pattern: gws <service> <resource> <method>.",
    inputSchema: {
      type: "object",
      properties: {
        service: {
          type: "string",
          description:
            "Google Workspace service (e.g., calendar, chat, admin, classroom, contacts, drive, gmail, sheets, docs, slides)",
        },
        resource: {
          type: "string",
          description:
            "API resource. Nested resources use dotted paths matching the API's REST structure — Gmail resources live under users (users.messages, users.drafts, users.labels, users.messages.attachments), not bare names like 'drafts'. Top-level examples: events (calendar), files (drive), spaces (chat).",
        },
        method: {
          type: "string",
          description: "API method (e.g., list, get, create, update, delete)",
        },
        params: {
          type: "object",
          description:
            "Query parameters as key-value pairs (e.g., { pageSize: 10, q: \"search query\" })",
        },
        json_body: {
          type: "object",
          description: "Request body for create/update operations (alias: body)",
        },
        body: {
          type: "object",
          description: "Request body for create/update operations (alias for json_body)",
        },
        page_all: {
          type: "boolean",
          description:
            "Fetch all pages of results (default: false, max 10 pages)",
        },
        dry_run: {
          type: "boolean",
          description: "Preview the request without executing it",
        },
      },
      required: ["service", "resource", "method"],
    },
    annotations: MUTATE("Run any Google Workspace API call (fallback)"),
  },
];

/**
 * A repeated param sent as a JSON string holding an array is that array
 * (SCRUM-298), the rule SCRUM-269 applies to the dedicated tools' array
 * arguments. Only the params the method declares repeated: anywhere else a
 * string that looks like a JSON array (a search query) is a string. An array
 * of objects or arrays is unwrapped too, so the client's own check refuses it
 * by name instead of it going out as one literal value. Returns a copy; the
 * caller's object is not changed.
 */
function unwrapRepeatedParams(
  service: string,
  resource: string,
  method: string,
  params: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!params) return params;
  let out = params;
  for (const key of repeatedParams(service, resource, method)) {
    const value = params[key];
    if (typeof value !== "string") continue;
    const unwrapped = unwrapJsonString(value, "array");
    if (unwrapped !== undefined) out = { ...out, [key]: unwrapped };
  }
  return out;
}

export async function handleGeneric(
  client: GwsClient,
  _toolName: string,
  args: Record<string, unknown>
) {
  const service = args.service as string;
  const resource = args.resource as string;
  const method = args.method as string;
  const result = await client.api(
    service,
    resource,
    method,
    {
      params: unwrapRepeatedParams(service, resource, method, args.params as Record<string, unknown> | undefined),
      jsonBody: args.json_body ?? args.body,
      pageAll: args.page_all as boolean | undefined,
      dryRun: args.dry_run as boolean | undefined,
    }
  );

  return jsonResponse(result.data);
}
