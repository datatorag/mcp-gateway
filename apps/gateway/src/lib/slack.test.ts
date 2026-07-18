import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockEnv: Record<string, string> = {};
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => mockEnv }));

import { sendSlack } from "./slack";

function okResponse() {
  return { ok: true, status: 200, json: async () => ({ ok: true }) };
}

describe("sendSlack", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
    mockEnv.SLACK_BOT_TOKEN = "xoxb-test";
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("no-ops (no fetch) when the bot token is empty", async () => {
    mockEnv.SLACK_BOT_TOKEN = "";
    mockEnv.SLACK_CHANNEL_LEADS = "C0LEADS";
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await sendSlack("leads", { text: "hi" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops (no fetch) when the channel id is empty", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await sendSlack("leads", { text: "hi" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs to chat.postMessage with bearer auth and the channel id", async () => {
    mockEnv.SLACK_CHANNEL_LEADS = "C0LEADS";
    const fetchSpy = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchSpy);
    await sendSlack("leads", { text: "new lead" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://slack.com/api/chat.postMessage");
    expect(init.method).toBe("POST");
    expect(init.headers.Authorization).toBe("Bearer xoxb-test");
    expect(JSON.parse(init.body)).toEqual({ channel: "C0LEADS", text: "new lead" });
  });

  it("resolves the correct channel env var per logical channel", async () => {
    mockEnv.SLACK_CHANNEL_ALERTS = "C0ALERTS";
    const fetchSpy = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchSpy);
    await sendSlack("alerts", { text: "boom" });
    expect(JSON.parse(fetchSpy.mock.calls[0][1].body).channel).toBe("C0ALERTS");
  });

  it("passes blocks through alongside the fallback text", async () => {
    mockEnv.SLACK_CHANNEL_DIGEST = "C0DIGEST";
    const fetchSpy = vi.fn().mockResolvedValue(okResponse());
    vi.stubGlobal("fetch", fetchSpy);
    await sendSlack("digest", { text: "digest", blocks: [{ type: "header" }] });
    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(body.blocks).toEqual([{ type: "header" }]);
  });

  it("never throws when fetch rejects", async () => {
    mockEnv.SLACK_CHANNEL_DIGEST = "C0DIGEST";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendSlack("digest", { text: "x" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("warns on ok:false API-level errors (HTTP 200)", async () => {
    mockEnv.SLACK_CHANNEL_LEADS = "C0LEADS";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: false, error: "not_in_channel" }),
      })
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendSlack("leads", { text: "x" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("not_in_channel"));
  });

  it("never throws on a non-2xx response", async () => {
    mockEnv.SLACK_CHANNEL_LEADS = "C0LEADS";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 404, json: async () => null })
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendSlack("leads", { text: "x" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
