/**
 * Which connected account an `account` value names, and the refusal when it
 * names more than one (SCRUM-366). Used by `resolveServiceToken`, which
 * re-exports the refusal's types and words for its callers.
 */
import { cleanWorkspaceName } from "./untrusted-text";

/** One account an ambiguous `account` value could have meant, and the value
 * that names it alone. */
export type AccountChoice = {
  /** What to pass as `account` to reach this one and nothing else. */
  account: string;
  email: string;
  /** The workspace name, for connectors with one (Notion). */
  workspace: string | null;
};

/** An `account` value that names more than one connected account. Refused,
 * never guessed: a guess is a call that may run, or write, as an account the
 * caller did not mean (SCRUM-366). */
export type AmbiguousAccount = {
  ambiguous: true;
  choices: AccountChoice[];
  /** Never present, so a caller that reads a token off a refusal without
   * checking `ambiguous` gets nothing and fails closed, as if no account
   * matched, rather than failing to compile at every existing call site. */
  token?: never;
  accountEmail?: never;
  scopes?: never;
};

/** The words for an ambiguous account. `requested` is shown as given, so the
 * caller passes it already made safe to echo.
 *
 * A workspace name is set by whoever administers that workspace (SCRUM-366),
 * so it is cleaned and capped (`cleanWorkspaceName`) and only ever appears as
 * a JSON-quoted value: a quote inside it is escaped and cannot close the
 * value, and no newline survives to start a line of its own. */
export function ambiguousAccountMessage(
  requested: string,
  choices: AccountChoice[]
): string {
  const quoted = (v: string) => JSON.stringify(v);
  const listed = choices
    .map((c) => {
      if (c.workspace === null) return `${quoted(c.account)} (${c.email})`;
      const workspace = cleanWorkspaceName(c.workspace) ?? "";
      // The value to pass is the workspace name itself when that is what
      // names the account alone; show it exactly as it is shown above.
      const account = c.account === c.workspace ? workspace : c.account;
      return `${quoted(account)} (${c.email}, workspace ${quoted(workspace)})`;
    })
    .join("; ");
  return `${quoted(requested)} matches more than one connected account. Pass one of these as the account argument: ${listed}.`;
}

export type AccountRow = {
  email: string;
  label: string | null;
  externalAccountId: string | null;
};

/** Whether `value` names this account. An email always does. A label or
 * external id does only on a row that carries an external id, which today
 * means a Notion workspace: a Google or Atlassian label is a display string,
 * never an address, so their routing is exactly what it was. */
export function accountMatches(row: AccountRow, value: string): boolean {
  if (row.email === value) return true;
  if (row.externalAccountId === null) return false;
  return row.label === value || row.externalAccountId === value;
}

/** The value that reaches `row` alone among `all`: the workspace name when it
 * is unique, else the workspace id, else the email. */
export function choiceFor(row: AccountRow, all: AccountRow[]): AccountChoice {
  const unique = (v: string | null): v is string =>
    v !== null && all.filter((r) => accountMatches(r, v)).length === 1;
  const account = [row.label, row.externalAccountId, row.email].find(unique) ??
    row.externalAccountId ??
    row.email;
  return { account, email: row.email, workspace: row.externalAccountId !== null ? row.label : null };
}
