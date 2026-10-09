import type { GwsClient } from "../gws-client.js";
import { CREATE, MUTATE, READ, ToolDef } from "./annotations.js";
import { jsonResponse, deleteResponse } from "./response.js";

export const contactsTools: ToolDef[] = [
  {
    name: "contacts_search",
    description:
      "Search Google Contacts by name, email, or phone number. Returns matching contacts with their details.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description:
            "Search query (name, email, phone number, or company name)",
        },
        max_results: {
          type: "number",
          description: "Maximum number of contacts to return (default: 10)",
        },
      },
      required: ["query"],
    },
    annotations: READ("Search contacts"),
  },
  {
    name: "contacts_get",
    description:
      "Get full details of a specific contact by their resource name.",
    inputSchema: {
      type: "object",
      properties: {
        resource_name: {
          type: "string",
          description:
            "Contact resource name (e.g., \"people/c1234567890\")",
        },
      },
      required: ["resource_name"],
    },
    annotations: READ("Get contact"),
  },
  {
    name: "contacts_list",
    description:
      "List contacts from the user's Google Contacts. Returns names, emails, phone numbers, and organizations.",
    inputSchema: {
      type: "object",
      properties: {
        max_results: {
          type: "number",
          description: "Maximum number of contacts to return (default: 20)",
        },
      },
      required: [],
    },
    annotations: READ("List contacts"),
  },
  {
    name: "contacts_create",
    description: "Create a new contact in Google Contacts.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Full name of the contact",
        },
        email: {
          type: "string",
          description: "Email address",
        },
        phone: {
          type: "string",
          description: "Phone number",
        },
        company: {
          type: "string",
          description: "Company or organization name",
        },
        title: {
          type: "string",
          description: "Job title",
        },
        notes: {
          type: "string",
          description: "Notes about the contact",
        },
      },
      required: ["name"],
    },
    annotations: CREATE("Create contact"),
  },
  {
    name: "contacts_update",
    description:
      "Update an existing contact. Only provided fields are changed.",
    inputSchema: {
      type: "object",
      properties: {
        resource_name: {
          type: "string",
          description:
            "Contact resource name (e.g., \"people/c1234567890\")",
        },
        name: {
          type: "string",
          description: "Updated full name",
        },
        email: {
          type: "string",
          description: "Updated email address",
        },
        phone: {
          type: "string",
          description: "Updated phone number",
        },
        company: {
          type: "string",
          description: "Updated company name",
        },
        title: {
          type: "string",
          description: "Updated job title",
        },
        notes: {
          type: "string",
          description: "Updated notes",
        },
      },
      required: ["resource_name"],
    },
    annotations: MUTATE("Update contact"),
  },
  {
    name: "contacts_delete",
    description: "Delete a contact from Google Contacts.",
    inputSchema: {
      type: "object",
      properties: {
        resource_name: {
          type: "string",
          description:
            "Contact resource name (e.g., \"people/c1234567890\")",
        },
      },
      required: ["resource_name"],
    },
    annotations: MUTATE("Delete contact"),
  },
  {
    name: "contacts_directory_search",
    description:
      "Search the company's Google Workspace directory (all users in the organization). Useful for finding colleagues' contact info.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query (name, email, or department)",
        },
        max_results: {
          type: "number",
          description: "Maximum number of results (default: 10)",
        },
      },
      required: ["query"],
    },
    annotations: READ("Search company directory"),
  },
];

const PERSON_FIELDS =
  "names,emailAddresses,phoneNumbers,organizations,biographies,metadata";

function buildPersonBody(args: Record<string, unknown>) {
  const body: Record<string, unknown> = {};

  if (args.name) {
    const parts = (args.name as string).split(" ");
    body.names = [
      {
        givenName: parts[0],
        familyName: parts.slice(1).join(" ") || undefined,
      },
    ];
  }
  if (args.email) {
    body.emailAddresses = [{ value: args.email }];
  }
  if (args.phone) {
    body.phoneNumbers = [{ value: args.phone }];
  }
  if (args.company || args.title) {
    body.organizations = [
      {
        name: args.company || undefined,
        title: args.title || undefined,
      },
    ];
  }
  if (args.notes) {
    body.biographies = [{ value: args.notes, contentType: "TEXT_PLAIN" }];
  }

  return body;
}

export async function handleContacts(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  switch (toolName) {
    case "contacts_search": {
      const result = await client.api("people", "people", "searchContacts", {
        params: {
          query: args.query,
          pageSize: (args.max_results as number) || 10,
          readMask: PERSON_FIELDS,
        },
      });
      return jsonResponse(result.data);
    }

    case "contacts_get": {
      const result = await client.api("people", "people", "get", {
        params: {
          resourceName: args.resource_name,
          personFields: PERSON_FIELDS,
        },
      });
      return jsonResponse(result.data);
    }

    case "contacts_list": {
      const result = await client.api("people", "people.connections", "list", {
        params: {
          resourceName: "people/me",
          pageSize: (args.max_results as number) || 20,
          personFields: PERSON_FIELDS,
          sortOrder: "LAST_NAME_ASCENDING",
        },
      });
      return jsonResponse(result.data);
    }

    case "contacts_create": {
      const result = await client.api("people", "people", "createContact", {
        jsonBody: buildPersonBody(args),
      });
      return jsonResponse(result.data);
    }

    case "contacts_update": {
      const body = buildPersonBody(args);
      const updateFields = Object.keys(body);

      const result = await client.api("people", "people", "updateContact", {
        params: {
          resourceName: args.resource_name,
          updatePersonFields: updateFields.join(","),
        },
        jsonBody: body,
      });
      return jsonResponse(result.data);
    }

    case "contacts_delete": {
      await client.api("people", "people", "deleteContact", {
        params: { resourceName: args.resource_name },
      });
      return deleteResponse("Contact");
    }

    case "contacts_directory_search": {
      const result = await client.api("people", "people", "searchDirectoryPeople", {
        params: {
          query: args.query,
          pageSize: (args.max_results as number) || 10,
          readMask: PERSON_FIELDS,
          sources: "DIRECTORY_SOURCE_TYPE_DOMAIN_PROFILE",
        },
      });
      return jsonResponse(result.data);
    }

    default:
      throw new Error(`Unknown Contacts tool: ${toolName}`);
  }
}
