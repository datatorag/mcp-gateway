import { z } from "zod";
import { ACCOUNT_ROLES, FIXTURE_KEYS, type AccountRole, type FixtureKey } from "./types";

/**
 * Roles and fixture keys onto real accounts and ids (SCRUM-303).
 *
 * This repo is public, so a case names `reader` and `sheet`; the mapping
 * lives in one config value and never in the tree. The important property is
 * what happens when a mapping is ABSENT: the case SKIPS, with the missing
 * name in its reason. It never falls back to a default account. A test that
 * silently runs as the wrong account is worse than one that does not run,
 * because it reports a pass about something nobody checked.
 */

const schema = z.object({
  accounts: z.record(z.string(), z.string()).default({}),
  users: z.record(z.string(), z.string()).default({}),
  fixtures: z.record(z.string(), z.string()).default({}),
});

export type FixtureMap = {
  /** Connected-account address for a role, or null. */
  account(role: AccountRole): string | null;
  /** Our own user id for a named user (today only `nonAdmin`), or null. */
  user(name: "nonAdmin"): string | null;
  /** The id behind a fixture key, or null. */
  fixture(key: FixtureKey): string | null;
  /** Every address this run was configured with, for the evidence scrub to
   * hold back. Addresses only: a user id or a file id is exactly what the
   * scrub exists to eat. */
  configuredAddresses(): string[];
  /** What a case needs but this run does not have, for the skip reason. */
  missingFor(needs: { accounts?: readonly AccountRole[]; fixtures?: readonly FixtureKey[] }): string[];
  /** True when the value was absent or unusable, so everything is missing. */
  readonly empty: boolean;
};

const EMPTY = { accounts: {}, users: {}, fixtures: {} };

/**
 * The roles that name one of OUR USERS rather than a connected account.
 *
 * Declared as a set rather than inferred, so adding a second user role is a
 * deliberate edit in one place instead of a string comparison copied to
 * wherever the distinction next matters.
 */
const USER_ROLES = new Set<AccountRole>(["nonAdmin"]);

export function isUserRole(role: AccountRole): role is "nonAdmin" {
  return USER_ROLES.has(role);
}

/**
 * Never throws. A malformed value reads as "nothing is mapped", which skips
 * cases; throwing here would take down the gateway at boot over a value that
 * only the test runner uses.
 */
export function parseFixtureMap(raw: string | undefined): FixtureMap {
  let parsed: z.infer<typeof schema> = EMPTY;
  let empty = true;

  if (raw && raw.trim() !== "") {
    try {
      const result = schema.safeParse(JSON.parse(raw));
      if (result.success) {
        parsed = result.data;
        empty = false;
      } else {
        console.warn("[test-runner] TEST_RUNNER_FIXTURES did not match its shape; treating it as unset");
      }
    } catch {
      console.warn("[test-runner] TEST_RUNNER_FIXTURES is not valid JSON; treating it as unset");
    }
  }

  const account = (role: AccountRole): string | null => {
    if (!ACCOUNT_ROLES.includes(role)) return null;
    const value = parsed.accounts[role];
    return typeof value === "string" && value.trim() !== "" ? value.trim().toLowerCase() : null;
  };
  const user = (name: "nonAdmin"): string | null => {
    const value = parsed.users[name];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  const fixture = (key: FixtureKey): string | null => {
    if (!FIXTURE_KEYS.includes(key)) return null;
    const value = parsed.fixtures[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };

  return {
    account,
    user,
    fixture,
    empty,
    configuredAddresses() {
      return ACCOUNT_ROLES.filter((r) => !isUserRole(r))
        .map((r) => account(r))
        .filter((a): a is string => a !== null);
    },
    missingFor(needs) {
      const missing: string[] = [];
      for (const role of needs.accounts ?? []) {
        // `nonAdmin` IS NOT A CONNECTED ACCOUNT, and looking it up as one
        // could only ever miss. It names one of our own USERS and lives
        // under `users` in the config; every other role names an address
        // under `accounts`. R2 skipped with "no mapping for
        // account:nonAdmin" while the mapping was present the whole time,
        // which is the worst shape of bug this runner can have: a case
        // that does not run, reporting a reason that sends you to fix
        // configuration that was already correct.
        const resolved = isUserRole(role) ? user(role) : account(role);
        if (resolved === null) missing.push(`${isUserRole(role) ? "user" : "account"}:${role}`);
      }
      for (const key of needs.fixtures ?? []) if (fixture(key) === null) missing.push(`fixture:${key}`);
      return missing;
    },
  };
}
