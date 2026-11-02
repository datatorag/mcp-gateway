import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * BR3 (Brevo scenario): the fixture contact's first name changed to a stamped
 * value, read back, and restored (SCRUM-468). A restoring pair on a fixture:
 * the connector cannot delete a contact, so a case never creates one.
 */
export const br3BrevoContactUpdate: TestCase = {
  id: "BR3",
  title: "a contact's attribute changed and restored",
  covers: ["brevo-mcp__contact_update"],
  cleanupCalls: ["brevo-mcp__contact_get"],
  accounts: ["brevo"],
  fixtures: ["brevoContact"],
  run: async (ctx) => {
    const identifier = ctx.fixture("brevoContact");
    const read = async () =>
      resultJson<{ attributes?: Record<string, unknown> }>("contact_get", await ctx.call("brevo-mcp__contact_get", { identifier }, { as: "brevo" }));
    const before = (await read()).attributes?.FIRSTNAME ?? "";
    const stamped = `[smoke] ${ctx.stamp}`;
    resultJson("contact_update", await ctx.call("brevo-mcp__contact_update", { identifier, attributes: { FIRSTNAME: stamped } }, { as: "brevo" }));
    try {
      const after = (await read()).attributes?.FIRSTNAME;
      if (after !== stamped) throw new Error("the changed first name did not read back");
    } finally {
      resultJson("contact_update", await ctx.call("brevo-mcp__contact_update", { identifier, attributes: { FIRSTNAME: before } }, { as: "brevo" }));
    }
    ctx.evidence("the first name changed, read back, and was restored");
  },
};
