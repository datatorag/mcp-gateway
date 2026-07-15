import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockEnv: Record<string, string> = {};
vi.mock("@datatorag-mcp/config", () => ({ getEnv: () => mockEnv }));

import { sendSlack } from "./slack";

describe("sendSlack", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
    vi.restoreAllMocks();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("no-ops (no fetch) when the channel's env var is empty", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await sendSlack("leads", { text: "hi" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs the message as JSON to the channel's webhook", async () => {
    mockEnv.SLACK_WEBHOOK_LEADS = "https://hooks.slack.example/T/lead";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
    await sendSlack("leads", { text: "new lead" });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://hooks.slack.example/T/lead");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ text: "new lead" });
  });

  it("resolves the correct env var per channel", async () => {
    mockEnv.SLACK_WEBHOOK_ALERTS = "https://hooks.slack.example/T/alert";
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 200 });
    vi.stubGlobal("fetch", fetchSpy);
    await sendSlack("alerts", { text: "boom" });
    expect(fetchSpy.mock.calls[0][0]).toBe("https://hooks.slack.example/T/alert");
  });

  it("never throws when fetch rejects", async () => {
    mockEnv.SLACK_WEBHOOK_DIGEST = "https://hooks.slack.example/T/digest";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendSlack("digest", { text: "x" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });

  it("never throws on a non-2xx response", async () => {
    mockEnv.SLACK_WEBHOOK_LEADS = "https://hooks.slack.example/T/lead";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 404 }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(sendSlack("leads", { text: "x" })).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
