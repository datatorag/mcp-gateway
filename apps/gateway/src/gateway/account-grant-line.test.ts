import { describe, expect, it } from "vitest";
import { grantLine } from "./account-grant-line";
import { GWS_SCOPE_LIST } from "./scope-grant";

const S = "https://www.googleapis.com/auth/";
const ALL = GWS_SCOPE_LIST.join(" ");
const EIGHT = ["Gmail", "Drive", "Calendar", "Docs", "Sheets", "Slides", "Contacts", "Tasks"];

describe("what an account granted, as the accounts tool reports it (SCRUM-412)", () => {
  it("a full Google grant lists all eight services, nothing missing, and no reconnect line", () => {
    expect(grantLine("google-workspace", ALL)).toEqual({
      granted_services: EIGHT,
      missing_services: [],
    });
  });

  it("reads a full grant as full in the spelling Google stores it", () => {
    // Google returns `email` as a userinfo URL. A naive compare would call
    // every complete grant short.
    const stored = ALL.replace(/\bemail\b/, `${S}userinfo.email`) + ` ${S}userinfo.profile`;
    expect(grantLine("google-workspace", stored).missing_services).toEqual([]);
  });

  it("a short grant names what is there and what is not, and where to fix it", () => {
    const line = grantLine("google-workspace", `openid email ${S}gmail.modify ${S}calendar`);
    expect(line.granted_services).toEqual(["Gmail", "Calendar"]);
    expect(line.missing_services).toEqual(["Drive", "Docs", "Sheets", "Slides", "Contacts", "Tasks"]);
    expect(line.reconnect).toContain("/dashboard/connections/google-workspace");
    expect(line.reconnect).toContain("tick every box");
  });

  it("an identity-only grant, the no-services case, grants nothing and says so", () => {
    const line = grantLine("google-workspace", "openid email");
    expect(line.granted_services).toEqual([]);
    expect(line.missing_services).toEqual(EIGHT);
    expect(line.reconnect).toBeDefined();
  });

  it("a grant that was never recorded says that, and claims nothing", () => {
    for (const scopes of [null, undefined, "", "   "]) {
      expect(grantLine("google-workspace", scopes), JSON.stringify(scopes)).toEqual({
        granted_services: "not recorded",
      });
    }
  });

  it("says nothing for a connector whose consent has no per-service choice", () => {
    expect(grantLine("atlassian", "read:jira-work write:jira-work")).toEqual({});
    expect(grantLine("atlassian", null)).toEqual({});
  });

  it("never puts a scope URL in front of a client", () => {
    const text = JSON.stringify(grantLine("google-workspace", `openid email ${S}drive`));
    expect(text).not.toContain("googleapis.com");
    expect(text).not.toContain("auth/");
  });
});
