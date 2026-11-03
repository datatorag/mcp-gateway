import { describe, expect, it } from "vitest";
import { allowedHost, sessionContext } from "./session-context.js";

const good = { "x-user-token": "pha_t", "x-posthog-host": "https://us.posthog.com", "x-posthog-project": "42" };

describe("the session's context", () => {
  it("takes a token, a regional host and a project", () => {
    expect(sessionContext(good)).toEqual({ ok: true, host: "https://us.posthog.com", project: "42", token: "pha_t" });
    expect(sessionContext({ ...good, "x-posthog-host": "https://eu.posthog.com/" })).toMatchObject({ ok: true, host: "https://eu.posthog.com" });
  });

  it.each([
    "https://evil.example",
    "https://us.posthog.com.evil.example",
    "https://us.posthog.com@evil.example",
    "https://us.posthog.com:8443",
    "https://us.posthog.com/api",
    "http://us.posthog.com",
    "https://oauth.posthog.com",
    "",
  ])("refuses the host %j, so the token goes nowhere", (host) => {
    expect(allowedHost(host)).toBeNull();
    expect(sessionContext({ ...good, "x-posthog-host": host })).toMatchObject({ ok: false });
  });

  it.each([undefined, "", "0", "abc", "42/../7", "-1", "4 2"])("refuses the project %j", (project) => {
    const r = sessionContext({ ...good, "x-posthog-project": project });
    expect(r).toMatchObject({ ok: false });
    if (!r.ok) expect(r.refusal).toMatch(/choose one project/);
  });

  it("refuses a session with no token", () => {
    expect(sessionContext({ ...good, "x-user-token": undefined })).toMatchObject({ ok: false });
  });
});
