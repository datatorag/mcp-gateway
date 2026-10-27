import type { TestCase } from "../types";

/**
 * F7 (Gateway scenario): a bearer that is not an OAuth access token is
 * refused, diagnosably. The value sent is in the format API keys had, before
 * they were removed (SCRUM-451): OAuth is the only way in, so a key, real or
 * made up, is an unknown token.
 *
 * Two failures, not one: such a bearer being ACCEPTED means a second way in
 * is open, and a bare 401 with nothing to act on means a client retries
 * silently instead of prompting for re-auth.
 *
 * The positive half, an OAuth token being accepted, is the door case R1.
 */
export const f7NonOauthBearerRefused: TestCase = {
  id: "F7",
  title: "a bearer that is not an OAuth access token is refused with a usable challenge",
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
    ctx.evidence(`old-format key: ${forged.status}, WWW-Authenticate ${forged.headers.get("www-authenticate") ?? "absent"}`);
    if (forged.status !== 401) throw new Error(`a bearer in the old key format was answered ${forged.status}, not 401`);

    const challenge = forged.headers.get("www-authenticate") ?? "";
    if (!/^Bearer/i.test(challenge)) throw new Error("the 401 carries no Bearer challenge");
    if (!challenge.includes("resource_metadata")) {
      throw new Error("the challenge names no resource_metadata, so a client cannot find where to re-auth");
    }
    if (!/invalid_token/.test(challenge)) {
      throw new Error("the challenge does not say invalid_token, so a client cannot tell a bad token from a missing one");
    }

    const anonymous = await ctx.http("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: initialize,
    });
    ctx.evidence(`control, no Authorization header: ${anonymous.status}`);
    if (anonymous.status !== 401) {
      throw new Error(`the unauthenticated control answered ${anonymous.status}, so the 401 above is not about the bearer`);
    }
  },
};
