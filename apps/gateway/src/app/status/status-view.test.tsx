import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { buildStatusModel, type RunRow } from "@/lib/status/read-model";
import { StatusView, relativeTime } from "./status-view";

/** The status page body (SCRUM-431), rendered as the page renders it. */

const RUN: RunRow = {
  id: "11111111-1111-4111-8111-111111111111",
  startedAt: new Date("2026-10-21T09:00:00Z"),
  finishedAt: new Date("2026-10-21T09:12:30Z"),
  gatewaySha: "abcdef0123456789",
  pluginShas: { "gws-mcp": "0123456789abcdef" },
};
const NOW = new Date("2026-10-21T15:00:00Z");
const row = (caseId: string, kind: string, status: string) => ({ caseId, kind, status, durationMs: 1500, cleanup: "clean" });
const RESULTS = [
  row("D10", "case", "pass"),
  row("GM8", "case", "fail"),
  row("JR12", "case", "pass"),
  row("contract:gws-mcp__gmail_send", "contract", "pass"),
  row("uncovered:gws-mcp__tasks_create_tasklist", "uncovered", "uncovered"),
];
const html = (now = NOW, results: object[] = RESULTS) =>
  renderToStaticMarkup(<StatusView model={buildStatusModel(RUN, results as never, [], now)} now={now} />);

describe("the status page body", () => {
  it("renders as it did (snapshot)", () => {
    expect(html()).toMatchSnapshot();
  });

  it("shows what failed by its title and state, and never the assertion text, an email, an id or who ran it", () => {
    const leaky = RESULTS.map((r) => ({
      ...r,
      evidence: "the reply did not arrive for someone@example.com, message 0000fake0000id00",
      triggeredBy: "22222222-2222-4222-8222-222222222222",
    }));
    const page = html(NOW, leaky);
    expect(page).toContain("Failing in the latest check");
    for (const secret of ["someone@example.com", "0000fake0000id00", "did not arrive", "22222222-2222-4222-8222-222222222222", RUN.id]) {
      expect(page).not.toContain(secret);
    }
  });

  it("puts the services in order with Platform last, and lists only those with something to show", () => {
    const page = html();
    expect(page.indexOf(">Gmail<")).toBeLessThan(page.indexOf(">Jira<"));
    expect(page).not.toContain(">Confluence<");
  });

  it("names a tool no check exercises as served, not yet exercised", () => {
    expect(html()).toContain("Served, not yet exercised");
  });

  it("says when the last check is older than 36 hours, and greys the states", () => {
    const fresh = html(new Date(RUN.finishedAt!.getTime() + 35 * 3600_000));
    const stale = html(new Date(RUN.finishedAt!.getTime() + 37 * 3600_000));
    expect(fresh).not.toContain("not from now");
    expect(stale).toContain("not from now");
    expect(stale).not.toContain("bg-success");
  });

  it("says so when no full check has run", () => {
    expect(renderToStaticMarkup(<StatusView model={null} now={NOW} />)).toContain("No full check has run yet");
  });

  it("writes no em dash", () => {
    expect(html()).not.toContain(String.fromCharCode(0x2014));
  });

  it("puts relative times in words", () => {
    expect(relativeTime("2026-10-21T14:30:00Z", NOW)).toBe("30 minutes ago");
    expect(relativeTime("2026-10-21T09:00:00Z", NOW)).toBe("6 hours ago");
    expect(relativeTime("2026-10-18T15:00:00Z", NOW)).toBe("3 days ago");
  });
});
