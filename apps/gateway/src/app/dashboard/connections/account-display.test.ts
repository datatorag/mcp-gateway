import { describe, expect, it } from "vitest";

import { accountDisplay, accountName } from "./account-display";

const EMAIL = "person@example.com";

/* SCRUM-436: Notion names a person by one email across every workspace, so
 * two Notion rows read the same unless the workspace name leads. */
describe("accountDisplay", () => {
  it("puts a Notion workspace name first and the email second", () => {
    expect(
      accountDisplay({ accountEmail: EMAIL, label: "Acme Team", externalAccountId: "ws-1" })
    ).toEqual({ primary: "Acme Team", secondary: EMAIL });
  });

  it("falls back to the email when a Notion row has no name", () => {
    expect(
      accountDisplay({ accountEmail: EMAIL, label: null, externalAccountId: "ws-1" })
    ).toEqual({ primary: EMAIL, secondary: null });
  });

  it("falls back to the email when the name cleans to nothing", () => {
    expect(
      accountDisplay({ accountEmail: EMAIL, label: "​ \n", externalAccountId: "ws-1" })
    ).toEqual({ primary: EMAIL, secondary: null });
  });

  it("leaves a Google or Atlassian row as it was: the email, its label untouched", () => {
    // A label on a row with no external id is the user's own display string,
    // not a name the account argument takes, so it never leads.
    expect(
      accountDisplay({ accountEmail: EMAIL, label: "Work", externalAccountId: null })
    ).toEqual({ primary: EMAIL, secondary: null });
    expect(accountDisplay({ accountEmail: EMAIL, label: "Work" })).toEqual({
      primary: EMAIL,
      secondary: null,
    });
  });

  it("shows the name the way list_connected_accounts does: cleaned", () => {
    expect(
      accountDisplay({
        accountEmail: EMAIL,
        label: "Acme‮\nTeam",
        externalAccountId: "ws-1",
      }).primary
    ).toBe("Acme Team");
  });
});

describe("accountName (one string, for sentences)", () => {
  it("names the workspace and the email for a Notion row", () => {
    expect(
      accountName({ accountEmail: EMAIL, label: "Acme Team", externalAccountId: "ws-1" })
    ).toBe("Acme Team (person@example.com)");
  });

  it("is the email for everything else", () => {
    expect(accountName({ accountEmail: EMAIL, label: null, externalAccountId: "ws-1" })).toBe(EMAIL);
    expect(accountName({ accountEmail: EMAIL, label: "Work", externalAccountId: null })).toBe(EMAIL);
  });
});
