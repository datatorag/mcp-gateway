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
  /** What a case needs but this run does not have, for the skip reason. */
  missingFor(needs: { accounts?: readonly AccountRole[]; fixtures?: readonly FixtureKey[] }): string[];
  /** True when the value was absent or unusable, so everything is missing. */
  readonly empty: boolean;
};

const EMPTY = { accounts: {}, users: {}, fixtures: {} };

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
    missingFor(needs) {
      const missing: string[] = [];
      for (const role of needs.accounts ?? []) if (account(role) === null) missing.push(`account:${role}`);
      for (const key of needs.fixtures ?? []) if (fixture(key) === null) missing.push(`fixture:${key}`);
      return missing;
    },
  };
}
