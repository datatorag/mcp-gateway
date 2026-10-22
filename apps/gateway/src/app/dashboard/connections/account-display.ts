import { cleanWorkspaceName } from "@/gateway/untrusted-text";

/** The fields a row needs to be named. `externalAccountId` is optional
 * because only Notion rows carry one. */
export interface NameableAccount {
  accountEmail: string;
  label: string | null;
  externalAccountId?: string | null;
}

/**
 * How a connected account is named on the dashboard (SCRUM-436).
 *
 * Notion names a person by ONE email across every workspace, so two Notion
 * rows under one login read identically if the email leads. A row with an
 * external id (today, a Notion workspace) therefore leads with its workspace
 * name, which is the same string the `account` argument takes for that row
 * (`accountMatches` in service-token.ts), and keeps the email as the second
 * line. Cleaned the way `list_connected_accounts` cleans it, so the name a
 * user reads here is the name the model reads there.
 *
 * Every other row is exactly what it was: the email. A Google or Atlassian
 * label is the user's own display string, not a name the account argument
 * takes, so it never leads. A Notion row with no usable name falls back to
 * the email.
 */
export function accountDisplay(account: NameableAccount): {
  primary: string;
  secondary: string | null;
} {
  const workspace =
    account.externalAccountId != null ? cleanWorkspaceName(account.label) : null;
  return workspace
    ? { primary: workspace, secondary: account.accountEmail }
    : { primary: account.accountEmail, secondary: null };
}

/** The same naming as one string, for a sentence ("Make X the default
 * account?"): the workspace with its email in brackets, or the email. */
export function accountName(account: NameableAccount): string {
  const { primary, secondary } = accountDisplay(account);
  return secondary ? `${primary} (${secondary})` : primary;
}
