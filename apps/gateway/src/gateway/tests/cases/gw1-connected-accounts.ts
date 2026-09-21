import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/** What the built-in returns: connector type to the accounts under it. */
type Grouped = Record<
  string,
  { email?: string; label?: string | null; is_default?: boolean; connected_at?: string }[]
>;

/**
 * GW1 (Gateway scenario): the connected-accounts built-in answers, and what
 * it says about defaults is coherent.
 *
 * A new step rather than a ported row. `list_connected_accounts` had no
 * case at all, which is the hole the regroup exists to find: nobody wrote a
 * smoke row for it, so nothing noticed, and it is not an obscure tool.
 *
 * It carries more weight than a reachability ping. Every plugin call
 * resolves an account, and a caller that omits `account` gets the DEFAULT.
 * This built-in is the only way a user sees which accounts exist and which
 * one that is, so what it says here is what a user relies on when deciding
 * whether a write will land where they meant.
 *
 * Three claims:
 *
 *  - it answers without an error for an identity that has connections;
 *  - the configured sender is among the accounts, so the answer is about
 *    THIS user rather than a fixed or empty shape;
 *  - no connector reports two defaults. Two is not a cosmetic duplicate: it
 *    means the account an argument-less call resolves to is decided by row
 *    order, so the same call can land in either mailbox and nothing in the
 *    answer tells the user which.
 *
 * It deliberately does NOT assert WHICH account is default. That is the
 * user's own choice and `ensureUsableDefault` is allowed to move it;
 * pinning it would turn a legitimate change red.
 */
export const gw1ConnectedAccounts: TestCase = {
  id: "GW1",
  title: "the connected accounts built-in answers for this identity",
  covers: ["list_connected_accounts"],
  accounts: ["sender"],
  run: async (ctx) => {
    /* `resultJson` already refuses an `isError` result and a non-JSON body,
     * with the tool's own words, clipped. A hand-rolled pre-check here was
     * both unreachable and the one place this case interpolated unbounded
     * tool text into evidence that a dashboard renders.
     *
     * The no-accounts answer is PROSE, so it lands in that same refusal
     * saying the built-in did not answer JSON. For this identity that is
     * the correct failure: it has connections. */
    const grouped = resultJson<Grouped>("list_connected_accounts", await ctx.call("list_connected_accounts", {}));
    if (!grouped || typeof grouped !== "object" || Array.isArray(grouped)) {
      throw new Error("the answer parsed as JSON but is not the connector-to-accounts object the built-in documents");
    }

    const connectors = Object.keys(grouped);
    const accounts = connectors.flatMap((k) => (Array.isArray(grouped[k]) ? grouped[k] : []));
    ctx.evidence(`${connectors.length} connector(s), ${accounts.length} account(s)`);
    if (accounts.length === 0) {
      throw new Error("the built-in answered with no accounts at all for an identity that has connections");
    }

    // The address is never written into evidence: it is configured and this
    // repository is public. Naming the ROLE is enough to act on.
    const sender = ctx.address("sender").toLowerCase();
    const emails = accounts.map((a) => String(a.email ?? "").toLowerCase());
    if (!emails.includes(sender)) {
      throw new Error(
        "the configured sender is not among the accounts returned, so the answer is not describing this identity"
      );
    }

    /* Checked PER CONNECTOR, because that is the scope the default is
     * resolved in. Counted rather than checked for presence: a connector
     * with no default is a legitimate state the resolver handles, two is
     * the ambiguity. */
    for (const connector of connectors) {
      const rows = Array.isArray(grouped[connector]) ? grouped[connector] : [];
      const defaults = rows.filter((r) => r.is_default === true);
      ctx.evidence(`${connector}: ${rows.length} account(s), ${defaults.length} default`);
      if (defaults.length > 1) {
        throw new Error(
          `${connector} reports ${defaults.length} default accounts, so an argument-less call resolves by row order rather than by a choice`
        );
      }
    }
  },
};
