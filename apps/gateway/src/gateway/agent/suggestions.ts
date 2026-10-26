import type { Database } from "@datatorag-mcp/db";
import { listConnectedAccounts } from "@/gateway/connected-accounts";
import { executeUserTool } from "@/gateway/playground/tools";
import { serviceGrantStates } from "@/gateway/scope-grant";
import {
  hasRealCorrespondence,
  suggestionsFor,
  withFileSuggestion,
  type Capability,
  type Suggestion,
  type SuggestionContext,
} from "./suggestion-generator";

/**
 * The agent's empty-state suggestions for one user (SCRUM-110, SCRUM-321):
 * the reads that build a `Capability`, then the pure generator.
 *
 * NO MODEL CALL, AND NO RUN SPENT. At most two plugin reads, both through
 * `executeUserTool`, which neither counts a call nor meters one: the inbox
 * check (Gmail) and one Drive search for the lowest slot. Charging someone's
 * allowance for something they did not ask for spends it by our choice.
 *
 * Nothing read here leaves this function except the suggestions themselves:
 * the inbox check is reduced to a yes or no, and of the Drive results only one
 * name survives, into the one slot allowed to name content.
 *
 * Never throws. A failure means fewer suggestions, not a broken page.
 */
export async function buildSuggestions(
  db: Database,
  userId: string,
  opts: { context: SuggestionContext; service?: string; limit?: number }
): Promise<Suggestion[]> {
  let cap: Capability;
  try {
    cap = await capabilityFor(db, userId);
  } catch {
    return [];
  }
  if (cap.services.size === 0) return [];

  const gmail = cap.googleServices.has("gmail");
  // The dashboard's cards deep-link by shape id, and the file line has no id
  // a link could resolve, so it belongs to the agent's empty states only.
  const drive = cap.googleServices.has("drive") && opts.context !== "dashboard";
  const [correspondence, fileName] = await Promise.all([
    gmail ? readCorrespondence(db, userId) : Promise.resolve(false),
    drive ? readOneDriveFileName(db, userId) : Promise.resolve(null),
  ]);
  cap.hasCorrespondence = correspondence;

  const shapes = suggestionsFor(cap, opts);
  if (shapes.length === 0) return [];
  return withFileSuggestion(shapes, fileName);
}

/** Connected services, the Google services the grants cover, and accounts per
 * service, from the user's own connected accounts. A legacy Google row with no
 * stored scopes reads as every service granted, the same fail-open rule
 * `scope-grant.ts` applies everywhere else. */
async function capabilityFor(db: Database, userId: string): Promise<Capability> {
  const rows = await listConnectedAccounts(db, userId);
  const services = new Set<string>();
  const googleServices = new Set<string>();
  const accountsPer = new Map<string, number>();
  for (const row of rows) {
    services.add(row.connectorType);
    accountsPer.set(row.connectorType, (accountsPer.get(row.connectorType) ?? 0) + 1);
    for (const state of serviceGrantStates(row.connectorType, row.scopes)) {
      if (state.granted) googleServices.add(state.iconKey);
    }
  }
  return { services, googleServices, accountsPer, hasCorrespondence: null };
}

/** Ten messages from the Primary tab, reduced to whether a person wrote any of
 * them. Only the answer is kept: no sender, subject or content leaves. */
async function readCorrespondence(db: Database, userId: string): Promise<boolean> {
  try {
    const result = await executeUserTool(db, userId, "gws-mcp__gmail_list", {
      label: "CATEGORY_PERSONAL",
      max_results: 10,
    });
    return !result.isError && hasRealCorrespondence(result.text);
  } catch {
    return false;
  }
}

/** The name of one recent Drive file, for the lowest slot, or null. */
async function readOneDriveFileName(db: Database, userId: string): Promise<string | null> {
  try {
    const result = await executeUserTool(db, userId, "gws-mcp__drive_search", { page_size: 6 });
    if (result.isError) return null;
    return fileNamesFrom(result.text)[0] ?? null;
  } catch {
    return null;
  }
}

/** Item names out of a search result, whatever envelope it arrived in.
 *
 * Deliberately forgiving: the plugin's response shape is not ours, and a
 * suggestion list is not worth throwing over. Anything unrecognised yields no
 * names, which the caller turns into no file line.
 */
export function fileNamesFrom(raw: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  const envelope = parsed as { files?: unknown; results?: unknown };
  const items = envelope?.files ?? envelope?.results ?? parsed;
  if (!Array.isArray(items)) return [];
  return items
    .map((f) => {
      const item = f as { name?: unknown; title?: unknown };
      return typeof item?.name === "string" ? item.name : item?.title;
    })
    .filter((n): n is string => typeof n === "string" && n.trim().length > 0)
    .map((n) => n.trim());
}
