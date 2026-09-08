import { describe, expect, it } from "vitest";
import { runEmail } from "./notify";

/* SCRUM-225: the one email a scheduled run may send. Outbound copy, so the
 * house rules are assertions: no em-dashes, a lowercase subject, one link per
 * path, and nothing a user did not already see in their own thread. */

const base = {
  skillTitle: "Get a morning brief across your mail, calendar and tasks with Claude",
  threadUrl: "https://example.com/dashboard/agent?thread=t-1",
  connectionsUrl: "https://example.com/dashboard/connections",
  billingUrl: "https://example.com/dashboard/billing",
  skillsUrl: "https://example.com/dashboard/skills",
  service: null as string | null,
  error: null as string | null,
  resultText: "Three things need you today. Two invites unanswered.",
};

const ALL = ["succeeded", "refused", "reconnect", "failed"] as const;

describe("runEmail", () => {
  it("has no em-dashes and a lowercase subject in every outcome", () => {
    for (const status of ALL) {
      const email = runEmail({ ...base, status });
      expect(email.subject).toBe(email.subject.toLowerCase());
      expect(email.subject + email.text + email.html).not.toContain("\u2014");
      expect(email.html).not.toContain("&mdash;");
    }
  });

  it("succeeded: the outcome, the result, and the thread link", () => {
    const email = runEmail({ ...base, status: "succeeded" });
    expect(email.subject).toContain("ran");
    expect(email.text).toContain("Three things need you today.");
    expect(email.text).toContain(base.threadUrl);
    expect(email.text).not.toContain(base.billingUrl);
  });

  it("refused: says the allowance is reached, what resets, and where to upgrade", () => {
    const email = runEmail({ ...base, status: "refused" });
    expect(email.subject).toContain("paused");
    expect(email.text).toContain("run allowance");
    expect(email.text).toContain(base.billingUrl);
    expect(email.text).toContain(base.skillsUrl);
  });

  it("reconnect: names the service and links the connect page, then the schedule to resume", () => {
    const email = runEmail({ ...base, status: "reconnect", service: "google-workspace" });
    expect(email.text).toContain("Google Workspace");
    expect(email.text).toContain(base.connectionsUrl);
    expect(email.text).toContain(base.skillsUrl);
  });

  it("failed: says it did not finish, carries the capped reason, links the thread", () => {
    const email = runEmail({ ...base, status: "failed", error: "provider unavailable" });
    expect(email.subject).toContain("did not finish");
    expect(email.text).toContain("provider unavailable");
    expect(email.text).toContain(base.threadUrl);
  });

  it("escapes user-visible text in the html part", () => {
    const email = runEmail({ ...base, status: "succeeded", resultText: "<script>alert(1)</script> & done" });
    expect(email.html).not.toContain("<script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).toContain("&amp; done");
  });

  it("caps the result excerpt so a long brief does not become the email", () => {
    const email = runEmail({ ...base, status: "succeeded", resultText: "x".repeat(5000) });
    expect(email.text.length).toBeLessThan(2500);
  });

  it("anchors only our own links; a URL the model repeated from a tool result stays plain text", () => {
    const email = runEmail({ ...base, status: "succeeded", resultText: "See https://example.org/click-me for details." });
    expect(email.html).toContain(`<a href="${base.threadUrl}">`);
    expect(email.html).not.toContain('href="https://example.org/click-me"');
    expect(email.html).toContain("https://example.org/click-me");
  });
});
