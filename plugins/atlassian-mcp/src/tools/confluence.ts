import type { AtlassianClient } from "../atlassian-client.js";
import { jsonResponse, textResponse } from "./response.js";

// ---------------------------------------------------------------------------
// Tool definitions
// ---------------------------------------------------------------------------

export const confluenceTools = [
  {
    name: "confluence_list_pages",
    description:
      "List pages in a Confluence space. Returns an array of pages with id, title, version, and link.",
    inputSchema: {
      type: "object" as const,
      properties: {
        space_key: {
          type: "string",
          description: "The key of the Confluence space (e.g. 'ENG').",
        },
        limit: {
          type: "number",
          description: "Maximum number of pages to return (default 25).",
        },
      },
      required: ["space_key"],
    },
    annotations: { title: "List Confluence pages", readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "confluence_get_page",
    description:
      "Get a single Confluence page by ID. Use format 'text' (default) for reading/summarizing — returns clean text with much less context usage. Use format 'storage' when you need to edit the page, as it returns the full XHTML storage format needed for write-back.",
    inputSchema: {
      type: "object" as const,
      properties: {
        page_id: {
          type: "string",
          description: "The ID of the page to retrieve.",
        },
        format: {
          type: "string",
          enum: ["text", "storage"],
          description:
            "Output format. 'text' (default): clean readable text, optimized for reading/summarizing. 'storage': raw XHTML storage format, needed for editing with confluence_edit_page.",
        },
      },
      required: ["page_id"],
    },
    annotations: { title: "Read Confluence page", readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "confluence_create_page",
    description:
      "Create a new page in Confluence. Content must be in XHTML storage format.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: {
          type: "string",
          description: "Title of the new page.",
        },
        content: {
          type: "string",
          description:
            "Page body in Confluence XHTML storage format (e.g. '<p>Hello</p>').",
        },
        space_key: {
          type: "string",
          description: "The key of the space to create the page in.",
        },
        parent_id: {
          type: "string",
          description:
            "Optional parent page ID to nest this page under.",
        },
      },
      required: ["title", "content", "space_key"],
    },
    annotations: { title: "Create Confluence page", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "confluence_edit_page",
    description:
      "Update an existing Confluence page. Content must be in XHTML storage format. If version is not provided the current version is fetched and auto-incremented.",
    inputSchema: {
      type: "object" as const,
      properties: {
        page_id: {
          type: "string",
          description: "The ID of the page to update.",
        },
        title: {
          type: "string",
          description: "New title for the page.",
        },
        content: {
          type: "string",
          description: "New body in XHTML storage format.",
        },
        version: {
          type: "number",
          description:
            "Version number for the update. If omitted the current version is auto-incremented.",
        },
      },
      required: ["page_id", "title", "content"],
    },
    annotations: { title: "Edit Confluence page", readOnlyHint: false, destructiveHint: true },
  },
  {
    name: "confluence_delete_page",
    description: "Delete a Confluence page by ID.",
    inputSchema: {
      type: "object" as const,
      properties: {
        page_id: {
          type: "string",
          description: "The ID of the page to delete.",
        },
      },
      required: ["page_id"],
    },
    annotations: { title: "Delete Confluence page", readOnlyHint: false, destructiveHint: true },
  },
  {
    name: "confluence_search",
    description:
      "Search Confluence content using CQL (Confluence Query Language). Returns matching pages/content with id, title, version, and link.",
    inputSchema: {
      type: "object" as const,
      properties: {
        cql: {
          type: "string",
          description:
            "CQL query string (e.g. 'type=page AND space=ENG AND title~\"onboarding\"').",
        },
        limit: {
          type: "number",
          description: "Maximum number of results to return (default 25).",
        },
      },
      required: ["cql"],
    },
    annotations: { title: "Search Confluence", readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "confluence_get_comments",
    description:
      "Get all comments on a Confluence page, footer and inline, with their replies, including their body content and version info. Each comment carries its type (footer or inline) and parent_id, the comment it replies to, or null for a comment on the page itself. An inline comment also carries the page text it is anchored to and whether it is open or resolved.",
    inputSchema: {
      type: "object" as const,
      properties: {
        page_id: {
          type: "string",
          description: "The ID of the page whose comments to retrieve.",
        },
      },
      required: ["page_id"],
    },
    annotations: { title: "Get Confluence comments", readOnlyHint: true, destructiveHint: false },
  },
  {
    name: "confluence_add_comment",
    description:
      "Add a comment to a Confluence page: a footer comment on the page, an inline comment anchored to a piece of the page's text with inline_text, or a reply to an existing footer or inline comment with parent_comment_id. A reply goes into the same kind of thread as the comment it answers. An inline_text that does not appear in the page is refused before anything is posted; when it appears more than once, inline_match picks which. Returns the new comment's ID, version, type and parent.",
    inputSchema: {
      type: "object" as const,
      properties: {
        page_id: {
          type: "string",
          description: "The ID of the page to comment on.",
        },
        body: {
          type: "string",
          description:
            "Comment text (plain text; will be wrapped in <p> tags automatically).",
        },
        parent_comment_id: {
          type: "string",
          description:
            "Optional ID of an existing comment, footer or inline, to reply to.",
        },
        inline_text: {
          type: "string",
          description:
            "Optional text on the page to anchor an inline comment to, exactly as it reads on the page. Not used with parent_comment_id.",
        },
        inline_match: {
          type: "number",
          description:
            "Which occurrence of inline_text to anchor to, counting from 1, when it appears more than once (default 1).",
        },
      },
      required: ["page_id", "body"],
    },
    annotations: { title: "Add Confluence comment", readOnlyHint: false, destructiveHint: false },
  },
  {
    name: "confluence_get_attachment",
    description:
      "Get metadata for a specific attachment on a Confluence page by filename.",
    inputSchema: {
      type: "object" as const,
      properties: {
        page_id: {
          type: "string",
          description: "The ID of the page the attachment belongs to.",
        },
        filename: {
          type: "string",
          description: "Exact filename of the attachment.",
        },
      },
      required: ["page_id", "filename"],
    },
    annotations: { title: "Get Confluence attachment", readOnlyHint: true, destructiveHint: false },
  },
] as const;

// ---------------------------------------------------------------------------
// Response helpers — shape the Confluence API response into something concise
// ---------------------------------------------------------------------------

interface V2Page {
  id: string;
  title: string;
  status?: string;
  spaceId?: string;
  parentId?: string | null;
  version?: { number: number };
  body?: {
    storage?: { value: string; representation?: string };
  };
  _links?: { webui?: string; base?: string };
}

interface V2PagesResult {
  results?: V2Page[];
  _links?: { base?: string; next?: string };
}

interface V2Comment {
  id: string;
  title?: string;
  version?: { number: number };
  body?: { storage?: { value: string } };
  resolutionStatus?: string;
  properties?: { inlineOriginalSelection?: string };
  _links?: { webui?: string };
}

interface V2CommentsResult {
  results?: V2Comment[];
  _links?: { base?: string };
}

interface V2Attachment {
  id: string;
  title: string;
  mediaType?: string;
  fileSize?: number;
  version?: { number: number };
  downloadLink?: string;
}

interface V2AttachmentsResult {
  results?: V2Attachment[];
  _links?: { base?: string };
}

// CQL search lives on v1 (no v2 equivalent). Each result wraps the page in
// a `content` envelope.
interface V1SearchResult {
  results?: Array<{
    title?: string;
    content?: {
      id: string;
      title?: string;
      version?: { number: number };
      _links?: { webui?: string };
    };
    // A CQL search RESULT carries its link as `url`, relative to the
    // response's `_links.base`. It has no `_links.webui` of its own; that
    // belongs to the wrapped `content`. The previous shape declared
    // `_links.webui` here, so the property read cleanly as undefined and
    // every row shipped link: null. Nothing failed; the type simply agreed
    // with the mistake.
    url?: string;
  }>;
  _links?: { base?: string };
}

function summarisePage(page: V2Page, baseUrl?: string) {
  return {
    id: page.id,
    title: page.title,
    version: page.version?.number ?? null,
    link: baseUrl && page._links?.webui
      ? `${baseUrl}${page._links.webui}`
      : page._links?.webui ?? null,
  };
}

// ---------------------------------------------------------------------------
// XHTML storage format → plain text converter
// ---------------------------------------------------------------------------

function xhtmlToText(xhtml: string): string {
  let text = xhtml;

  // Replace headings with markdown-style headings
  text = text.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level, content) => {
    const prefix = "#".repeat(Number(level));
    return `\n${prefix} ${stripTags(content).trim()}\n`;
  });

  // Convert tables to markdown tables
  text = text.replace(/<table[^>]*>([\s\S]*?)<\/table>/gi, (_m, tableContent) => {
    const rows: string[][] = [];
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let rowMatch;
    while ((rowMatch = rowRegex.exec(tableContent)) !== null) {
      const cells: string[] = [];
      const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
      let cellMatch;
      while ((cellMatch = cellRegex.exec(rowMatch[1])) !== null) {
        cells.push(stripTags(cellMatch[1]).trim());
      }
      if (cells.length > 0) rows.push(cells);
    }
    if (rows.length === 0) return "";
    const colCount = Math.max(...rows.map((r) => r.length));
    const padded = rows.map((r) => {
      while (r.length < colCount) r.push("");
      return r;
    });
    let md = "\n| " + padded[0].join(" | ") + " |\n";
    md += "| " + padded[0].map(() => "---").join(" | ") + " |\n";
    for (let i = 1; i < padded.length; i++) {
      md += "| " + padded[i].join(" | ") + " |\n";
    }
    return md;
  });

  // Lists
  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, content) => {
    return `\n- ${stripTags(content).trim()}`;
  });

  // Code blocks
  text = text.replace(
    /<ac:structured-macro[^>]*ac:name="code"[^>]*>[\s\S]*?<ac:plain-text-body>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ac:plain-text-body>[\s\S]*?<\/ac:structured-macro>/gi,
    (_m, code) => `\n\`\`\`\n${code.trim()}\n\`\`\`\n`,
  );

  // Confluence macros: extract text content, drop the macro wrapper
  text = text.replace(
    /<ac:structured-macro[^>]*>([\s\S]*?)<\/ac:structured-macro>/gi,
    (_m, inner) => {
      // Extract rich-text-body content if present
      const bodyMatch = inner.match(
        /<ac:rich-text-body>([\s\S]*?)<\/ac:rich-text-body>/i,
      );
      return bodyMatch ? bodyMatch[1] : "";
    },
  );

  // Links
  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href, linkText) => {
    const clean = stripTags(linkText).trim();
    return clean ? `[${clean}](${href})` : href;
  });

  // Confluence user mentions
  text = text.replace(
    /<ac:link><ri:user[^>]*ri:userkey="[^"]*"[^/]*\/><ac:plain-text-link-body>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/ac:plain-text-link-body><\/ac:link>/gi,
    (_m, name) => `@${name.trim()}`,
  );

  // Images / attachments: note their presence without the data
  text = text.replace(/<ac:image[^>]*>[\s\S]*?<ri:attachment ri:filename="([^"]*)"[^/]*\/>[\s\S]*?<\/ac:image>/gi,
    (_m, filename) => `[image: ${filename}]`,
  );

  // Line breaks and paragraphs
  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<\/p>/gi, "\n");
  text = text.replace(/<p[^>]*>/gi, "");

  // Strip remaining HTML tags
  text = stripTags(text);

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Clean up whitespace: collapse multiple blank lines
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

// ---------------------------------------------------------------------------
// Comment threads
// ---------------------------------------------------------------------------

type CommentKind = "footer" | "inline";

/** A thread deeper than this is listed to this depth. Confluence nests
 * replies without a limit; a conversation that deep is rare, and each level
 * is one more request per comment. */
const MAX_REPLY_DEPTH = 5;

function refusal(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shapeComment(c: V2Comment, type: CommentKind, parentId: string | null) {
  return {
    id: c.id,
    title: c.title ?? null,
    version: c.version?.number ?? null,
    type,
    parent_id: parentId,
    body: c.body?.storage?.value ?? null,
    ...(type === "inline"
      ? {
          selection: c.properties?.inlineOriginalSelection ?? null,
          resolution_status: c.resolutionStatus ?? null,
        }
      : {}),
  };
}

/** The comments given, each followed by its replies, depth first, so a
 * thread reads in order. */
async function withReplies(
  client: AtlassianClient,
  comments: V2Comment[],
  type: CommentKind,
  parentId: string | null,
  depth: number,
): Promise<ReturnType<typeof shapeComment>[]> {
  const children = depth >= MAX_REPLY_DEPTH
    ? comments.map(() => [] as V2Comment[])
    : await Promise.all(
        comments.map(async (c) =>
          ((await client.confluenceV2Get(
            `/${type}-comments/${encodeURIComponent(c.id)}/children?body-format=storage`,
          )) as V2CommentsResult).results ?? [],
        ),
      );
  const out: ReturnType<typeof shapeComment>[] = [];
  for (const [i, c] of comments.entries()) {
    out.push(shapeComment(c, type, parentId));
    out.push(...(await withReplies(client, children[i], type, c.id, depth + 1)));
  }
  return out;
}

/** Whether a comment ID names a footer or an inline comment, or neither. */
async function commentKind(client: AtlassianClient, id: string): Promise<CommentKind | null> {
  for (const kind of ["footer", "inline"] as const) {
    try {
      await client.confluenceV2Get(`/${kind}-comments/${encodeURIComponent(id)}`);
      return kind;
    } catch {
      // Not this kind, or not readable: try the other.
    }
  }
  return null;
}

/** A page's storage body as the words a reader sees, for finding where an
 * inline comment's text sits. Tags go, the XML entities, &nbsp; and numeric
 * character references are decoded, and nothing else is rewritten, so the
 * count matches the text the page shows. A non-breaking space stays one, so
 * text typed with an ordinary space does not match it and is refused here
 * rather than by Confluence. */
export function pageText(storage: string): string {
  return storage
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, "\u00a0")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_m, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");
}

export function countOccurrences(text: string, needle: string): number {
  if (needle === "") return 0;
  let count = 0;
  for (let at = text.indexOf(needle); at !== -1; at = text.indexOf(needle, at + needle.length)) count++;
  return count;
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handleConfluence(
  client: AtlassianClient,
  toolName: string,
  args: Record<string, unknown>,
) {
  switch (toolName) {
    // ── List pages ────────────────────────────────────────────────
    case "confluence_list_pages": {
      const spaceKey = args.space_key as string;
      const limit = (args.limit as number | undefined) ?? 25;
      const spaceId = await client.getSpaceIdByKey(spaceKey);

      const data = (await client.confluenceV2Get(
        `/spaces/${encodeURIComponent(spaceId)}/pages?limit=${limit}`,
      )) as V2PagesResult;

      const baseUrl = data._links?.base;
      const pages = (data.results ?? []).map((p) => summarisePage(p, baseUrl));
      return jsonResponse(pages);
    }

    // ── Get page ──────────────────────────────────────────────────
    case "confluence_get_page": {
      const pageId = args.page_id as string;
      const format = (args.format as string | undefined) ?? "text";

      const page = (await client.confluenceV2Get(
        `/pages/${encodeURIComponent(pageId)}?body-format=storage`,
      )) as V2Page;

      const rawBody = page.body?.storage?.value ?? null;

      if (format === "storage") {
        return jsonResponse({
          id: page.id,
          title: page.title,
          version: page.version?.number ?? null,
          format: "storage",
          body: rawBody,
        });
      }

      return textResponse(
        `# ${page.title}\n\n` +
          `Page ID: ${page.id} | Version: ${page.version?.number ?? "?"}\n\n` +
          (rawBody ? xhtmlToText(rawBody) : "(empty page)"),
      );
    }

    // ── Create page ───────────────────────────────────────────────
    case "confluence_create_page": {
      const title = args.title as string;
      const content = args.content as string;
      const spaceKey = args.space_key as string;
      const parentId = args.parent_id as string | undefined;
      const spaceId = await client.getSpaceIdByKey(spaceKey);

      const payload: Record<string, unknown> = {
        spaceId,
        status: "current",
        title,
        body: {
          representation: "storage",
          value: content,
        },
      };

      if (parentId) {
        payload.parentId = parentId;
      }

      const created = (await client.confluenceV2Post(
        "/pages",
        payload,
      )) as V2Page;

      return jsonResponse({
        id: created.id,
        title: created.title,
        version: created.version?.number ?? null,
        link: created._links?.webui ?? null,
      });
    }

    // ── Edit page ─────────────────────────────────────────────────
    case "confluence_edit_page": {
      const pageId = args.page_id as string;
      const title = args.title as string;
      const content = args.content as string;
      let version = args.version as number | undefined;

      if (version === undefined) {
        const current = (await client.confluenceV2Get(
          `/pages/${encodeURIComponent(pageId)}`,
        )) as V2Page;
        version = (current.version?.number ?? 0) + 1;
      }

      const payload = {
        id: pageId,
        status: "current",
        title,
        body: {
          representation: "storage",
          value: content,
        },
        version: { number: version },
      };

      const updated = (await client.confluenceV2Put(
        `/pages/${encodeURIComponent(pageId)}`,
        payload,
      )) as V2Page;

      return jsonResponse({
        id: updated.id,
        title: updated.title,
        version: updated.version?.number ?? null,
      });
    }

    // ── Delete page ───────────────────────────────────────────────
    case "confluence_delete_page": {
      const pageId = args.page_id as string;
      await client.confluenceV2Delete(
        `/pages/${encodeURIComponent(pageId)}`,
      );
      return textResponse(`Page ${pageId} deleted.`);
    }

    // ── Search (CQL — v1 endpoint, no v2 equivalent) ──────────────
    case "confluence_search": {
      const cql = args.cql as string;
      const limit = (args.limit as number | undefined) ?? 25;

      const data = (await client.confluenceV1Get(
        `/search?cql=${encodeURIComponent(cql)}&limit=${limit}&expand=content.version`,
      )) as V1SearchResult;

      const baseUrl = data._links?.base;
      const results = (data.results ?? []).map((r) => {
        const c = r.content;
        const id = c?.id ?? "";
        const title = c?.title ?? r.title ?? "";
        const version = c?.version?.number ?? null;
        // Prefer the result's own `url`, which every result carries; fall
        // back to the wrapped content's webui link for result types that
        // supply one and no url.
        const relative = r.url ?? c?._links?.webui ?? null;
        return {
          id,
          title,
          version,
          link: baseUrl && relative ? `${baseUrl}${relative}` : relative,
        };
      });
      return jsonResponse(results);
    }

    // ── Get comments (merge footer + inline) ──────────────────────
    case "confluence_get_comments": {
      const pageId = args.page_id as string;

      const [footer, inline] = (await Promise.all([
        client.confluenceV2Get(
          `/pages/${encodeURIComponent(pageId)}/footer-comments?body-format=storage`,
        ),
        client.confluenceV2Get(
          `/pages/${encodeURIComponent(pageId)}/inline-comments?body-format=storage`,
        ),
      ])) as [V2CommentsResult, V2CommentsResult];

      // The page endpoints list only the comments on the page itself; a
      // reply is a child of the comment it answers, so each thread is walked.
      const comments = [
        ...(await withReplies(client, footer.results ?? [], "footer", null, 0)),
        ...(await withReplies(client, inline.results ?? [], "inline", null, 0)),
      ];
      return jsonResponse(comments);
    }

    // ── Add comment (footer, inline, or a reply in either thread) ─
    case "confluence_add_comment": {
      const pageId = args.page_id as string;
      const body = args.body as string;
      const parentCommentId = args.parent_comment_id as string | undefined;

      const inlineText = typeof args.inline_text === "string" ? args.inline_text : undefined;
      const storageBody = {
        representation: "storage",
        value: `<p>${escapeXml(body)}</p>`,
      };

      if (parentCommentId && inlineText !== undefined) {
        return refusal("parent_comment_id and inline_text do not go together: a reply sits in its parent's thread, wherever that is anchored. Nothing was posted.");
      }

      if (parentCommentId) {
        // A reply has to go to the endpoint of its parent's kind, so the
        // parent is looked up first; a footer endpoint refuses an inline
        // parent and the reverse.
        const kind = await commentKind(client, parentCommentId);
        if (!kind) {
          return refusal(`No footer or inline comment ${JSON.stringify(parentCommentId)} could be read, so there is nothing to reply to. Nothing was posted.`);
        }
        const created = (await client.confluenceV2Post(`/${kind}-comments`, {
          parentCommentId,
          body: storageBody,
        })) as V2Comment;
        return jsonResponse({
          id: created.id,
          version: created.version?.number ?? null,
          type: kind,
          parent_id: parentCommentId,
        });
      }

      if (inlineText !== undefined) {
        if (inlineText.trim() === "") return refusal("inline_text is empty, so there is nothing to anchor to. Nothing was posted.");
        const page = (await client.confluenceV2Get(
          `/pages/${encodeURIComponent(pageId)}?body-format=storage`,
        )) as V2Page;
        const count = countOccurrences(pageText(page.body?.storage?.value ?? ""), inlineText);
        if (count === 0) {
          return refusal(`The text ${JSON.stringify(inlineText)} does not appear on page ${pageId}, so an inline comment cannot be anchored to it. Nothing was posted.`);
        }
        const match = args.inline_match === undefined ? 1 : args.inline_match;
        if (!Number.isInteger(match) || (match as number) < 1 || (match as number) > count) {
          return refusal(`inline_match is ${JSON.stringify(args.inline_match)}, and the text appears ${count} time(s) on the page. Nothing was posted.`);
        }
        const created = (await client.confluenceV2Post("/inline-comments", {
          pageId,
          body: storageBody,
          inlineCommentProperties: {
            textSelection: inlineText,
            textSelectionMatchCount: count,
            textSelectionMatchIndex: (match as number) - 1,
          },
        })) as V2Comment;
        return jsonResponse({
          id: created.id,
          version: created.version?.number ?? null,
          type: "inline",
          parent_id: null,
          selection: inlineText,
        });
      }

      const created = (await client.confluenceV2Post("/footer-comments", {
        pageId,
        body: storageBody,
      })) as V2Comment;

      return jsonResponse({
        id: created.id,
        version: created.version?.number ?? null,
        type: "footer",
        parent_id: null,
      });
    }

    // ── Get attachment (filter by filename client-side) ───────────
    case "confluence_get_attachment": {
      const pageId = args.page_id as string;
      const filename = args.filename as string;

      const data = (await client.confluenceV2Get(
        `/pages/${encodeURIComponent(pageId)}/attachments?limit=250`,
      )) as V2AttachmentsResult;

      const baseUrl = data._links?.base;
      const matches = (data.results ?? []).filter((a) => a.title === filename);

      if (matches.length === 0) {
        return textResponse(
          `No attachment named "${filename}" found on page ${pageId}.`,
        );
      }

      const attachments = matches.map((a) => ({
        id: a.id,
        title: a.title,
        version: a.version?.number ?? null,
        mediaType: a.mediaType ?? null,
        fileSize: a.fileSize ?? null,
        downloadLink: baseUrl && a.downloadLink
          ? `${baseUrl}${a.downloadLink}`
          : a.downloadLink ?? null,
      }));

      return jsonResponse(attachments.length === 1 ? attachments[0] : attachments);
    }

    default:
      throw new Error(`Unknown Confluence tool: ${toolName}`);
  }
}
