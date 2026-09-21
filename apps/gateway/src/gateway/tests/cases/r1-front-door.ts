import type { TestCase } from "../types";

/**
 * R1: the FRONT DOOR, which the rest of this suite skips by construction.
 *
 * The runner is an in-process client, so everything it proves is proved
 * about the layer BELOW the HTTP handling of /mcp. That is deliberate, and
 * it leaves a gap exactly the size of the bearer check and the session
 * layer.
 *
 * This closes the anonymous half from here: an unauthenticated initialize
 * must be refused with the documented challenge, and the metadata that
 * challenge points at must exist. The POSITIVE half, a real credential being
 * accepted, is the daily trigger itself: the box calls tests_run through
 * this door, so a broken door means no run at all, which is the loudest
 * failure this suite has.
 *
 * It records what it did NOT prove, rather than implying a whole-door check.
 */
export const r1FrontDoor: TestCase = {
  id: "R1",
  title: "the /mcp front door answers over real HTTP",
  tier: 1,
  covers: [],
  accounts: [],
  run: async (ctx) => {
    const res = await ctx.http("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "smoke", version: "0" },
        },
      }),
    });

    ctx.evidence(`unauthenticated POST /mcp answered ${res.status}`);
    if (res.status !== 401) {
      throw new Error(`the front door answered ${res.status} to an anonymous initialize, not 401`);
    }
    const challenge = res.headers.get("www-authenticate") ?? "";
    if (!challenge.includes("resource_metadata")) {
      throw new Error("the front door's 401 carries no resource_metadata, so a client cannot find the door");
    }

    const metadata = await ctx.http("/.well-known/oauth-protected-resource");
    ctx.evidence(`protected-resource metadata answered ${metadata.status}`);
    if (metadata.status !== 200) {
      throw new Error(`the metadata the challenge points at answered ${metadata.status}`);
    }

    ctx.evidence(
      "NOT proven here: that a valid credential is accepted. The daily trigger arrives through this door, so a broken one means no run at all."
    );
  },
};
