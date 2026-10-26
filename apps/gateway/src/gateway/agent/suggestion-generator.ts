/**
 * What the agent's empty states suggest (SCRUM-110, SCRUM-321).
 *
 * CAPABILITY FIRST, CONTENT SECOND. The input is what this user can do: which
 * services are connected, which Google services the grant covers, how many
 * accounts each service has, and whether the inbox holds real mail. A
 * suggestion derived from content (a file name) can only ever be a read of
 * one file in one service, which is the shape SCRUM-110 objects to, so
 * content fills exactly one slot, the last, and only when Drive is there.
 *
 * Pure: everything here is a function of its arguments. The reads that build
 * a `Capability` live in `suggestions.ts`.
 */

export type SuggestionContext = "first_run" | "post_connect" | "dashboard";
export type ServiceId = "google-workspace" | "atlassian" | "notion";
export type ShapeKind = "chain" | "write" | "multi_account" | "read";

export type Capability = {
  /** Connected services. */
  services: Set<string>;
  /** Google services the grant covers, by `API_SCOPES` icon key: gmail,
   * drive, calendar, docs, sheets, slides, contacts, tasks. */
  googleServices: Set<string>;
  /** Connected accounts per service. */
  accountsPer: Map<string, number>;
  /** Whether a quick inbox read found mail from a person. Null until it
   * answers, which counts as no. */
  hasCorrespondence: boolean | null;
};

export type Shape = {
  /** Stable: it is what the events carry, and what a deep link names. */
  id: string;
  needs: {
    services: ServiceId[];
    google?: string[];
    /** Accounts needed on the first service. */
    minAccounts?: number;
    correspondence?: boolean;
  };
  kind: ShapeKind;
  /** Works on an account with no history (SCRUM-321). */
  freshAccount: boolean;
  /** What the user sees and what is sent. Reviewed by HQ before it ships. */
  text: string;
};

export type Suggestion = { id: string; text: string };

/** The catalogue. Every visible string is here, so the review is one list. */
export const SHAPES: readonly Shape[] = [
  {
    id: "mail_to_status_doc",
    needs: { services: ["google-workspace"], google: ["gmail", "docs"], correspondence: true },
    kind: "chain",
    freshAccount: false,
    text: "Summarize my recent email and draft a status update in Google Docs",
  },
  {
    id: "jira_from_doc",
    needs: { services: ["atlassian", "google-workspace"], google: ["docs"] },
    kind: "chain",
    freshAccount: true,
    text: "Turn the action items in a Google Doc into Jira tickets",
  },
  {
    id: "sheet_from_paste",
    needs: { services: ["google-workspace"], google: ["sheets"] },
    kind: "write",
    freshAccount: true,
    text: "Turn a list I paste into a Google Sheet with a header row and readable columns",
  },
  {
    id: "doc_from_paste",
    needs: { services: ["google-workspace"], google: ["docs"] },
    kind: "write",
    freshAccount: true,
    text: "Turn notes I paste into a formatted Google Doc with headings",
  },
  {
    id: "task_list",
    needs: { services: ["google-workspace"], google: ["tasks"] },
    kind: "write",
    freshAccount: true,
    text: "Make a task list for this week from what I tell you",
  },
  {
    id: "focus_block",
    needs: { services: ["google-workspace"], google: ["calendar"] },
    kind: "write",
    freshAccount: true,
    text: "Put a 30-minute focus block on my calendar tomorrow morning",
  },
  {
    id: "jira_issue_from_text",
    needs: { services: ["atlassian"] },
    kind: "write",
    freshAccount: true,
    text: "Create a Jira issue from a bug report I paste",
  },
  {
    id: "notion_page_from_paste",
    needs: { services: ["notion"] },
    kind: "write",
    freshAccount: true,
    text: "Turn notes I paste into a Notion page",
  },
  {
    id: "two_inboxes",
    needs: { services: ["google-workspace"], google: ["gmail"], minAccounts: 2, correspondence: true },
    kind: "multi_account",
    freshAccount: false,
    text: "Check both of my inboxes for anything that needs a reply today",
  },
  {
    id: "week_calendar",
    needs: { services: ["google-workspace"], google: ["calendar"] },
    kind: "read",
    freshAccount: true,
    text: "What's on my calendar this week, and where are the gaps?",
  },
  {
    id: "jira_assigned",
    needs: { services: ["atlassian"] },
    kind: "read",
    freshAccount: true,
    text: "List the Jira issues assigned to me that changed this week",
  },
  {
    id: "notion_find_page",
    needs: { services: ["notion"] },
    kind: "read",
    freshAccount: true,
    text: "Find a page in my Notion workspace and summarize it",
  },
];

/** The file-name shape's id: the only suggestion whose text names content. */
export const FILE_SHAPE_ID = "drive_file_summary";

const KIND_RANK: Record<ShapeKind, number> = { chain: 0, write: 1, multi_account: 2, read: 3 };

function eligible(shape: Shape, cap: Capability): boolean {
  const { services, google = [], minAccounts, correspondence } = shape.needs;
  if (!services.every((s) => cap.services.has(s))) return false;
  if (!google.every((g) => cap.googleServices.has(g))) return false;
  if (minAccounts && (cap.accountsPer.get(services[0]) ?? 0) < minAccounts) return false;
  if (correspondence && cap.hasCorrespondence !== true) return false;
  return true;
}

/**
 * Up to `limit` suggestions, in order, for one empty state.
 *
 * The rules, in the order they apply: only what the connected services can
 * serve; on a first run, shapes that work on a fresh account first; chains and
 * writes ahead of multi-account and reads; never two of one kind; and no
 * padding, so one service gives what that service can do and stops. After a
 * connect, the first suggestion uses the service just connected.
 */
export function suggestionsFor(
  cap: Capability,
  opts: { context: SuggestionContext; service?: string; limit?: number }
): Suggestion[] {
  const limit = opts.limit ?? 3;
  const ranked = SHAPES.filter((shape) => eligible(shape, cap))
    .map((shape, order) => ({ shape, order }))
    .sort((a, b) => {
      const key = (s: Shape) => [
        opts.context === "post_connect" && opts.service && !s.needs.services.includes(opts.service as ServiceId)
          ? 1
          : 0,
        opts.context === "first_run" && !s.freshAccount ? 1 : 0,
        KIND_RANK[s.kind],
      ];
      const ka = key(a.shape);
      const kb = key(b.shape);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return ka[i] - kb[i];
      return a.order - b.order;
    });

  const kinds = new Set<ShapeKind>();
  const out: Suggestion[] = [];
  for (const { shape } of ranked) {
    if (out.length === limit) break;
    if (kinds.has(shape.kind)) continue;
    kinds.add(shape.kind);
    out.push({ id: shape.id, text: shape.text });
  }
  return out;
}

const FILE_NAME_MAX = 40;

/** Put one suggestion naming the user's own Drive file in the LOWEST slot of
 * three, never higher, the name quoted and cut to 40 characters. Without a
 * file name the list is returned as it was. */
export function withFileSuggestion(suggestions: Suggestion[], fileName: string | null): Suggestion[] {
  if (!fileName) return suggestions;
  const name =
    fileName.length > FILE_NAME_MAX ? `${fileName.slice(0, FILE_NAME_MAX - 1)}…` : fileName;
  return [...suggestions.slice(0, 2), { id: FILE_SHAPE_ID, text: `Summarize "${name}" for me` }];
}

/** Senders that are notifications rather than people. A heuristic, and one
 * that errs towards "no correspondence": a false no only hides a suggestion. */
const NOTIFICATION_SENDER =
  /\b(no-?reply|do-?not-?reply|notifications?|notify|alerts?|mailer-daemon|postmaster|updates?|news(letter)?|marketing|billing|receipts?|security|accounts?|info|support|hello|team)@/i;

/** Whether a `gmail_list` result holds at least one message from a person.
 * Reads the `from` field and nothing else, and returns only the answer. */
export function hasRealCorrespondence(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!Array.isArray(parsed)) return false;
  return parsed.some((m) => {
    const from = (m as { from?: unknown })?.from;
    return typeof from === "string" && from.includes("@") && !NOTIFICATION_SENDER.test(from);
  });
}

/** The text for a shape id, for a deep link that names one. Null for any id
 * not in the catalogue: a deep link carries an id, never text. */
export function shapeText(id: string): string | null {
  return SHAPES.find((s) => s.id === id)?.text ?? null;
}
