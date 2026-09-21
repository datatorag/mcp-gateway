import type { TestCase } from "../types";

/**
 * F7 (Gateway scenario): a fabricated API key is refused, diagnosably.
 *
 * Two failures, not one: a made-up key being ACCEPTED means the credential
 * path is open, and a bare 401 with nothing to act on means a client with a
 * rotated key retries silently instead of prompting for re-auth.
 *
 * The positive half, a real key being accepted, is the door case R1.
 */
export const f7ApiKeyRefused: TestCase = {
  id: "F7",
  title: "a fabricated API key is refused with a usable challenge",
  covers: [],
  accounts: [],
  run: async (ctx) => {
    const initialize = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "smoke", version: "0" } },
    });

    const forged = await ctx.http("/mcp", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        authorization: `Bearer sk-dtrmcp_${ctx.stamp}notarealkey`,
      },
      body: initialize,
    });
    ctx.evidence(`forged key: ${forged.status}, WWW-Authenticate ${forged.headers.get("www-authenticate") ?? "absent"}`);
    if (forged.status !== 401) throw new Error(`a fabricated key was answered ${forged.status}, not 401`);

    const challenge = forged.headers.get("www-authenticate") ?? "";
    if (!/^Bearer/i.test(challenge)) throw new Error("the 401 carries no Bearer challenge");
    if (!challenge.includes("resource_metadata")) {
      throw new Error("the challenge names no resource_metadata, so a client cannot find where to re-auth");
    }
    if (!/invalid_token/.test(challenge)) {
      throw new Error("the challenge does not say invalid_token, so a client cannot tell a bad key from a missing one");
    }

    const anonymous = await ctx.http("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: initialize,
    });
    ctx.evidence(`control, no Authorization header: ${anonymous.status}`);
    if (anonymous.status !== 401) {
      throw new Error(`the unauthenticated control answered ${anonymous.status}, so the 401 above is not about the key`);
    }
  },
};
