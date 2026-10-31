/**
 * SCRUM-466: routines and tests never call `connect` with a `service`. Named,
 * it makes a link even for a connected provider, and for a provider that is
 * not connected it would show an unattended client a prompt nobody answers.
 * GW2 is the runner's one call to it, so this pins that it names none.
 */
import { describe, expect, it } from "vitest";
import { gw2ConnectTool } from "./gw2-connect-tool";
import type { CaseContext } from "../types";

describe("GW2", () => {
  it("calls connect with no arguments at all, so never with a service", async () => {
    const calls: Array<{ tool: string; args: Record<string, unknown> }> = [];
    const ctx = {
      call: async (tool: string, args: Record<string, unknown>) => {
        calls.push({ tool, args });
        return {
          content: [],
          structuredContent: {
            providers: [{ id: "google-workspace", connected: true, accounts: [{ email: "sender@example.com" }], connect_url: null }],
          },
        };
      },
      address: () => "sender@example.com",
      evidence: () => undefined,
    } as unknown as CaseContext;
    await gw2ConnectTool.run(ctx);
    expect(calls).toEqual([{ tool: "connect", args: {} }]);
  });
});
