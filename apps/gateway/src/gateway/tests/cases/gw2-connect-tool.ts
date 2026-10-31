import type { TestCase } from "../types";

type Provider = {
  id?: string;
  connected?: boolean;
  accounts?: { email?: string }[];
  connect_url?: string | null;
};

/**
 * GW2 (Gateway scenario): the connect built-in reports this identity's
 * connections and makes no link for a provider that is connected
 * (SCRUM-466).
 *
 * Called with no `service`, which is the call that has no side effect for a
 * connected provider: a link is made only for a provider that is not
 * connected, or for one named in `service`, so this case never names one. If
 * this identity ever lacks a provider, the answer carries a link for it,
 * which expires unused in ten minutes; the case says so in evidence and
 * still checks the rest.
 *
 * Three claims:
 *
 *  - it answers without an error, with one structured entry per provider;
 *  - the configured sender is among the Google Workspace accounts, so the
 *    answer is about THIS user;
 *  - no connected provider carries a link, so the answer does not hand out
 *    a credential nobody asked for.
 */
export const gw2ConnectTool: TestCase = {
  id: "GW2",
  title: "the connect built-in reports this identity and makes no link for what is connected",
  covers: ["connect"],
  accounts: ["sender"],
  run: async (ctx) => {
    const result = await ctx.call("connect", {});
    // The tool's own words are left out: an answer from connect can carry a
    // link, and evidence is shown on a dashboard.
    if (result.isError) throw new Error("connect answered with an error");
    const providers = (result.structuredContent as { providers?: Provider[] } | undefined)?.providers;
    if (!Array.isArray(providers) || providers.length === 0) {
      throw new Error("connect answered with no structured providers, which the built-in documents");
    }
    ctx.evidence(`${providers.length} provider(s): ${providers.map((p) => `${p.id}=${p.connected ? "connected" : "not connected"}`).join(", ")}`);

    // The address is never written into evidence: this repository is public.
    const sender = ctx.address("sender").toLowerCase();
    const google = providers.find((p) => p.id === "google-workspace");
    const emails = (google?.accounts ?? []).map((a) => String(a.email ?? "").toLowerCase());
    if (!emails.includes(sender)) {
      throw new Error("the configured sender is not among the Google Workspace accounts, so the answer is not describing this identity");
    }

    for (const p of providers) {
      if (p.connected && p.connect_url) {
        throw new Error(`${p.id} is connected and still carries a link, so connect hands out a credential nobody asked for`);
      }
      if (!p.connected) ctx.evidence(`${p.id} is not connected for this identity; its link expires unused`);
    }
  },
};
