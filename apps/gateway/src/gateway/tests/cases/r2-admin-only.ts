import type { TestCase } from "../types";

/**
 * R2: the admin tools are invisible AND unreachable to a non-admin.
 *
 * Two claims, and the second is the security boundary. A client can call any
 * name it likes without ever listing, so a filter on the listing is
 * presentation only. What matters is that the CALL answers exactly as it
 * would for a name nobody ever registered.
 *
 * It probes as a mapped non-admin user of ours against the live gateway,
 * which is the half the unit suite cannot reach. Without that mapping it
 * skips, because a case that quietly ran as an admin would assert the
 * opposite of what it claims.
 */
export const r2AdminOnly: TestCase = {
  id: "R2",
  title: "a non-admin can neither see nor call the runner's own tools",
  tier: 1,
  covers: [],
  accounts: ["nonAdmin"],
  run: async (ctx) => {
    const body = await ctx.gateway.nonAdminView();

    if (body.skipped) throw new Error(`could not probe as a non-admin: ${body.skipped}`);

    ctx.evidence(`a non-admin was served ${body.listed} tools`);
    if (body.listed === 0) {
      throw new Error("the non-admin was served nothing at all, so any absence below proves nothing");
    }
    if (body.visibleAdminTools.length > 0) {
      throw new Error(`a non-admin can see ${body.visibleAdminTools.join(", ")}`);
    }

    // Compared against the answer an unregistered name gets, never against a
    // literal: the claim is that the two are the SAME, and it has to survive
    // the wording changing.
    const control = body.normalisedRefusals[body.unregisteredName];
    if (!control) throw new Error("the probe returned no control answer for an unregistered name");

    for (const [name, refusal] of Object.entries(body.normalisedRefusals)) {
      if (name === body.unregisteredName) continue;
      if (refusal !== control) {
        throw new Error(`calling ${name} as a non-admin answers differently from an unregistered name`);
      }
    }
    ctx.evidence(
      `${Object.keys(body.normalisedRefusals).length - 1} admin names refused identically to an unregistered one`
    );
  },
};
