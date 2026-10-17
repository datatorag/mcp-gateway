import { notInArray } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { tools } from "@datatorag-mcp/db";
import { resolveUserEmail } from "./user-email";

/**
 * Who may see and call gws_run (SCRUM-419, part 3).
 *
 * gws_run is the raw Google API fallback. Every call it was being used for
 * now has a dedicated tool, and a model that is offered the fallback reaches
 * for it even where a dedicated tool exists. So it is listed and callable
 * only for the accounts named in GWS_RUN_ALLOWED_ACCOUNTS (comma-separated
 * login emails, matched without case; empty or unset means nobody). The
 * registry row stays: the tool exists for those accounts and for the smoke
 * suite, which runs as the admin who triggers it.
 *
 * The emails live in the environment only, never in this repository.
 *
 * Read from process.env at call time rather than through getEnv(), whose
 * parsed copy is fixed at first use: a change to the variable takes effect
 * on the next container start either way, and the tests can set it per case.
 */

export const GWS_RUN_TOOL = "gws-mcp__gws_run";

/** The answer to a direct call from an account that is not listed. Fixed
 * text: it names the dedicated tool families and nothing about the list. */
export const GWS_RUN_REFUSAL =
  "gws_run is not available on this account; use the gmail_, calendar_, drive_, sheets_, docs_ or tasks_ tools.";

/** Registry rows that exist but are never advertised on a public page or in
 * a public count. gws_run is one, for everyone, allowlisted or not: the
 * public surface describes what a new user gets. */
export const PUBLICLY_UNLISTED_TOOLS: readonly string[] = [GWS_RUN_TOOL];

/** The where-clause every public read of the tools table carries: the home
 * and pricing counts, /tools/<slug> and the servers listing. A filter here
 * rather than a mark on the row, because the only mark the row has is
 * `enabled`, and clearing it would hide the tool from the allowlist too. */
export const publiclyListedTool = () => notInArray(tools.namespacedName, [...PUBLICLY_UNLISTED_TOOLS]);

function allowedAccounts(): Set<string> {
  return new Set(
    (process.env.GWS_RUN_ALLOWED_ACCOUNTS ?? "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0)
  );
}

/** Whether an account with this login email may see and call gws_run. An
 * unknown email (null) may not: a failed lookup hides the tool. */
export function gwsRunAllowedFor(email: string | null | undefined): boolean {
  if (!email) return false;
  return allowedAccounts().has(email.trim().toLowerCase());
}

/** True when this tool is gws_run and this user may not have it. The email
 * lookup only runs for gws_run, so every other tool pays nothing. */
export async function gwsRunHiddenFrom(
  db: Database,
  userId: string,
  namespacedName: string
): Promise<boolean> {
  if (namespacedName !== GWS_RUN_TOOL) return false;
  return !gwsRunAllowedFor(await resolveUserEmail(db, userId));
}
