import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ getSessionUserId: vi.fn(async () => "user-1") }));
vi.mock("@/lib/db", () => ({ db: {} }));
const buildSuggestions = vi.fn(async () => []);
vi.mock("@/gateway/agent/suggestions", () => ({ buildSuggestions }));

const { GET } = await import("./route");

const get = (query: string) => GET(new NextRequest(`http://localhost/api/agent/suggestions?${query}`));

describe("the suggestions route's service after a connect", () => {
  beforeEach(() => buildSuggestions.mockClear());

  it("passes every connectable service through, Slack included (SCRUM-454)", async () => {
    for (const service of ["google-workspace", "atlassian", "notion", "slack"]) {
      await get(`context=post_connect&service=${service}`);
      expect(buildSuggestions).toHaveBeenLastCalledWith(expect.anything(), "user-1", {
        context: "post_connect",
        service,
      });
    }
  });

  it("drops a service it does not know", async () => {
    await get("context=post_connect&service=dropbox");
    expect(buildSuggestions).toHaveBeenLastCalledWith(expect.anything(), "user-1", {
      context: "post_connect",
      service: undefined,
    });
  });
});
