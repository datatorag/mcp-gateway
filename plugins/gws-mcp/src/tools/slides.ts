import type { GwsClient } from "../gws-client.js";
import { CREATE, MUTATE, READ, ToolDef } from "./annotations.js";
import { jsonResponse } from "./response.js";
import { deleteDriveFileResponse } from "./drive-ops.js";

export const slidesTools: ToolDef[] = [
  {
    name: "slides_get",
    description:
      "Get the content of a Google Slides presentation. Returns slide objectIds, placeholder types (TITLE/BODY/SUBTITLE), and text content — stripped of layout/styling data to fit context windows. Use the returned objectIds with slides_batch_update for edits.",
    inputSchema: {
      type: "object",
      properties: {
        presentation_id: {
          type: "string",
          description: "The Google Slides presentation ID (from the URL)",
        },
      },
      required: ["presentation_id"],
    },
    annotations: READ("Read presentation"),
  },
  {
    name: "slides_create",
    description:
      "Create a new Google Slides presentation. Returns the presentationId and a placeholder_map for each slide mapping placeholder types (TITLE, BODY, SUBTITLE) to their objectIds — use these with slides_batch_update insertText.",
    inputSchema: {
      type: "object",
      properties: {
        title: {
          type: "string",
          description: "Title for the new presentation",
        },
      },
      required: ["title"],
    },
    annotations: CREATE("Create presentation"),
  },
  {
    name: "slides_batch_update",
    description:
      "Apply batch updates to a Google Slides presentation. Supports inserting text, replacing text, creating slides, deleting objects, and other modifications. Uses the Google Slides API batchUpdate format.",
    inputSchema: {
      type: "object",
      properties: {
        presentation_id: {
          type: "string",
          description: "The presentation ID",
        },
        requests: {
          type: "array",
          description:
            "Array of update request objects. Examples: createSlide ({ createSlide: { slideLayoutReference: { predefinedLayout: \"TITLE_AND_BODY\" } } }), insertText ({ insertText: { objectId: \"slideId\", text: \"Hello\", insertionIndex: 0 } }), replaceAllText ({ replaceAllText: { containsText: { text: \"old\" }, replaceText: \"new\" } }), deleteObject ({ deleteObject: { objectId: \"elementId\" } })",
          items: { type: "object" },
        },
      },
      required: ["presentation_id", "requests"],
    },
    annotations: MUTATE("Edit presentation"),
  },
  {
    name: "slides_delete",
    description:
      "Delete a Google Slides presentation. This permanently removes the file from Drive.",
    inputSchema: {
      type: "object",
      properties: {
        presentation_id: {
          type: "string",
          description: "The presentation ID to delete",
        },
      },
      required: ["presentation_id"],
    },
    annotations: MUTATE("Delete presentation"),
  },
];

interface SlideElement {
  objectId?: string;
  shape?: {
    placeholder?: { type?: string };
    text?: {
      textElements?: Array<{
        textRun?: { content?: string };
      }>;
    };
  };
}

interface SlideData {
  objectId?: string;
  pageElements?: SlideElement[];
}

function trimPresentation(data: Record<string, unknown>) {
  const slides = (data.slides as SlideData[]) || [];
  return {
    presentationId: data.presentationId,
    title: data.title,
    slides: slides.map((slide) => {
      const elements = (slide.pageElements || [])
        .filter((el) => el.shape?.placeholder || el.shape?.text?.textElements?.length)
        .map((el) => {
          const textElements = el.shape?.text?.textElements || [];
          const text = textElements
            .map((te) => te.textRun?.content || "")
            .join("");
          const result: { objectId?: string; placeholderType?: string; text?: string } = {
            objectId: el.objectId,
          };
          if (el.shape?.placeholder?.type) {
            result.placeholderType = el.shape.placeholder.type;
          }
          if (text) result.text = text;
          return result;
        });

      const placeholderMap: Record<string, string> = {};
      for (const el of elements) {
        if (el.placeholderType && el.objectId) {
          placeholderMap[el.placeholderType] = el.objectId;
        }
      }

      return {
        objectId: slide.objectId,
        placeholder_map: placeholderMap,
        elements,
      };
    }),
  };
}

/** Trimmed outline of a presentation, for callers that want data rather than
 * an MCP response envelope (slides_get itself, drive_read_file). */
export async function getPresentationOutline(
  client: GwsClient,
  presentationId: unknown
) {
  const result = await client.api("slides", "presentations", "get", {
    params: { presentationId },
  });
  return trimPresentation(result.data as Record<string, unknown>);
}

export async function handleSlides(
  client: GwsClient,
  toolName: string,
  args: Record<string, unknown>
) {
  switch (toolName) {
    case "slides_get":
      return jsonResponse(await getPresentationOutline(client, args.presentation_id));

    case "slides_create": {
      const result = await client.api("slides", "presentations", "create", {
        jsonBody: { title: args.title },
      });
      return jsonResponse(trimPresentation(result.data as Record<string, unknown>));
    }

    case "slides_batch_update": {
      const result = await client.api(
        "slides",
        "presentations",
        "batchUpdate",
        {
          params: { presentationId: args.presentation_id },
          jsonBody: { requests: args.requests },
        }
      );
      return jsonResponse(result.data);
    }

    case "slides_delete":
      return deleteDriveFileResponse(client, args.presentation_id, "Presentation");

    default:
      throw new Error(`Unknown Slides tool: ${toolName}`);
  }
}
