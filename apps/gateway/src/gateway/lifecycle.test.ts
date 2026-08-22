import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";

// isInternalEmail (used unmocked via importOriginal below) reads
// INTERNAL_EXCLUDE_EMAILS from env — real getEnv() would exit on missing
// DATABASE_URL in the test environment.
vi.mock("@datatorag-mcp/config", () => ({
  getEnv: () => ({ INTERNAL_EXCLUDE_EMAILS: "founder@example.com" }),
}));

const hasKey = vi.fn(() => true);
const upsert = vi.fn();
const sendTpl = vi.fn();
vi.mock("../lib/brevo", async (importOriginal) => {
  const real = await importOriginal<typeof import("../lib/brevo")>();
  return {
    ...real,
    hasBrevoKey: () => hasKey(),
    upsertBrevoContact: (...args: unknown[]) => upsert(...args),
    sendBrevoTemplate: (...args: unknown[]) => sendTpl(...args),
  };
});
vi.mock("../lib/slack", () => ({
  sendSlack: vi.fn().mockResolvedValue(undefined),
}));

import {
  firstNameOf,
  sendWelcomeEmail,
  runNoActivationFollowup,
  followupBranch,
  listInProse,
  LIFECYCLE_LAUNCH,
} from "./lifecycle";
import { sendSlack } from "../lib/slack";
import {
  BREVO_TEMPLATE_NO_ACTIVATION,
  BREVO_TEMPLATE_FOLLOWUP_CONNECT,
  BREVO_TEMPLATE_FOLLOWUP_PERMISSIONS,
  BREVO_TEMPLATE_FOLLOWUP_TRY_THIS,
} from "../lib/brevo";

/** A grant where the user unticked everything Google lets them untick: the
 * identity scopes come back, no API scope does. This is the shape that got
 * the setup-instructions email instead of the permissions one. */
const IDENTITY_ONLY_SCOPES =
  "openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile";

const FULL_SCOPES = [
  "openid",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/presentations",
  "https://www.googleapis.com/auth/contacts",
  "https://www.googleapis.com/auth/tasks",
].join(" ");

const selectWhere = vi.fn();
const returning = vi.fn();
const select = vi.fn(() => ({ from: () => ({ where: selectWhere }) }));
const dbMock = {
  select,
  update: () => ({ set: () => ({ where: () => ({ returning }) }) }),
} as unknown as Database;

describe("firstNameOf", () => {
  it("takes the first word, falling back to 'there'", () => {
    expect(firstNameOf("Manuel Yang")).toBe("Manuel");
    expect(firstNameOf("  Ada   Lovelace ")).toBe("Ada");
    expect(firstNameOf(null)).toBe("there");
    expect(firstNameOf("")).toBe("there");
  });
});

describe("sendWelcomeEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    hasKey.mockReturnValue(true);
    upsert.mockResolvedValue(true);
    sendTpl.mockResolvedValue(true);
  });

  it("skips internal accounts entirely", async () => {
    await sendWelcomeEmail({ email: "someone@datatorag.com", name: "Someone" });
    await sendWelcomeEmail({ email: "founder@example.com", name: "Founder" });
    expect(upsert).not.toHaveBeenCalled();
    expect(sendTpl).not.toHaveBeenCalled();
  });

  it("no-ops with a warning when the key is missing", async () => {
    hasKey.mockReturnValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendWelcomeEmail({ email: "new@user.com", name: "New" });
    expect(upsert).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("upserts the contact then sends welcome template 2 with FIRSTNAME", async () => {
    await sendWelcomeEmail({
      email: "ada@example.com",
      name: "Ada Lovelace",
      plan: "free",
      createdAt: new Date("2026-07-18T01:00:00Z"),
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ email: "ada@example.com", firstName: "Ada" })
    );
    expect(sendTpl).toHaveBeenCalledWith(2, "ada@example.com", {
      FIRSTNAME: "Ada",
    });
  });
});

describe("listInProse", () => {
  it("reads as a list mid-sentence at every length", () => {
    expect(listInProse([])).toBe("");
    expect(listInProse(["Gmail"])).toBe("Gmail");
    expect(listInProse(["Gmail", "Drive"])).toBe("Gmail and Drive");
    expect(listInProse(["Gmail", "Drive", "Calendar"])).toBe(
      "Gmail, Drive and Calendar"
    );
  });
});

describe("followupBranch", () => {
  it("has no connection row at all → the connect nudge", () => {
    expect(followupBranch([])).toEqual({
      state: "no-connection",
      templateId: BREVO_TEMPLATE_FOLLOWUP_CONNECT,
      missingServices: [],
    });
  });

  it("has a row the grant does not cover → the permissions email, naming what is missing", () => {
    const branch = followupBranch([
      { service: "google-workspace", scopes: IDENTITY_ONLY_SCOPES },
    ]);
    expect(branch.state).toBe("missing-permissions");
    expect(branch.templateId).toBe(BREVO_TEMPLATE_FOLLOWUP_PERMISSIONS);
    expect(branch.missingServices).toEqual([
      "Gmail",
      "Drive",
      "Calendar",
      "Docs",
      "Sheets",
      "Slides",
      "Contacts",
      "Tasks",
    ]);
  });

  it("names only the services the grant actually left out", () => {
    const partial = FULL_SCOPES.split(" ")
      .filter(
        (s) =>
          s !== "https://www.googleapis.com/auth/gmail.modify" &&
          s !== "https://www.googleapis.com/auth/tasks"
      )
      .join(" ");
    const branch = followupBranch([
      { service: "google-workspace", scopes: partial },
    ]);
    expect(branch.state).toBe("missing-permissions");
    expect(branch.missingServices).toEqual(["Gmail", "Tasks"]);
  });

  it("has a complete row → the try-this nudge", () => {
    expect(followupBranch([
      { service: "google-workspace", scopes: FULL_SCOPES },
    ])).toEqual({
      state: "connected",
      templateId: BREVO_TEMPLATE_FOLLOWUP_TRY_THIS,
      missingServices: [],
    });
  });

  it("counts a service as missing only when NO connection covers it", () => {
    // Multi-account is supported (service_connections is non-unique per
    // user+service), so a second account can cover what the first left out.
    const gmailOnly = [
      "openid",
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/gmail.modify",
    ].join(" ");
    expect(
      followupBranch([
        { service: "google-workspace", scopes: gmailOnly },
        { service: "google-workspace", scopes: FULL_SCOPES },
      ]).state
    ).toBe("connected");
    expect(
      followupBranch([
        { service: "google-workspace", scopes: gmailOnly },
        { service: "google-workspace", scopes: IDENTITY_ONLY_SCOPES },
      ]).missingServices
    ).not.toContain("Gmail");
  });

  it("treats a legacy null-scopes row as connected, matching scopeDelta's fail-open", () => {
    expect(
      followupBranch([{ service: "google-workspace", scopes: null }]).state
    ).toBe("connected");
  });
});

describe("runNoActivationFollowup", () => {
  const NOW = new Date("2026-07-25T16:15:00Z");

  /** The run makes two reads in order: the candidate users, then those
   * users' connection rows. */
  const seed = (
    candidates: unknown[],
    connections: unknown[]
  ): void => {
    selectWhere
      .mockResolvedValueOnce(candidates)
      .mockResolvedValueOnce(connections);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    hasKey.mockReturnValue(true);
    sendTpl.mockReset();
    sendTpl.mockResolvedValue(true);
    selectWhere.mockReset();
    selectWhere.mockResolvedValue([]);
    returning.mockReset();
    returning.mockResolvedValue([{ id: "u1" }]);
  });

  it("exits before touching the db when the key is missing", async () => {
    hasKey.mockReturnValue(false);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await runNoActivationFollowup(dbMock, { now: NOW });
    expect(res).toEqual({ eligible: 0, sent: 0, failed: 0 });
    expect(select).not.toHaveBeenCalled();
    warnSpy.mockRestore();
  });

  it("claims then sends once, filtering internal users", async () => {
    seed(
      [
        { id: "u1", email: "real@user.com", name: "Real User" },
        { id: "u2", email: "founder@example.com", name: "Founder" },
      ],
      []
    );
    const res = await runNoActivationFollowup(dbMock, { now: NOW });
    expect(res).toEqual({ eligible: 1, sent: 1, failed: 0 });
    expect(sendTpl).toHaveBeenCalledTimes(1);
    expect(sendTpl).toHaveBeenCalledWith(
      BREVO_TEMPLATE_FOLLOWUP_CONNECT,
      "real@user.com",
      { FIRSTNAME: "Real" }
    );
  });

  it("never double-sends when the claim loses the race", async () => {
    seed([{ id: "u1", email: "real@user.com", name: "Real" }], []);
    returning.mockResolvedValue([]);
    const res = await runNoActivationFollowup(dbMock, { now: NOW });
    expect(res.sent).toBe(0);
    expect(sendTpl).not.toHaveBeenCalled();
  });

  it("alerts ops when a claimed send fails", async () => {
    seed([{ id: "u1", email: "real@user.com", name: "Real" }], []);
    sendTpl.mockResolvedValue(false);
    const res = await runNoActivationFollowup(dbMock, { now: NOW });
    expect(res).toEqual({ eligible: 1, sent: 0, failed: 1 });
    expect(sendSlack).toHaveBeenCalledWith(
      "alerts",
      expect.objectContaining({
        text: expect.stringContaining("real@user.com"),
      })
    );
  });

  // SCRUM-140: the failure this branch exists for. A user whose connection
  // carries only the identity scopes has nothing wrong with their client
  // config, so the setup-instructions email sends them to debug the wrong
  // end of the problem.
  it("sends the PERMISSIONS template, never the setup-instructions one, on an identity-only grant", async () => {
    seed(
      [{ id: "u1", email: "real@user.com", name: "Real" }],
      [
        {
          userId: "u1",
          service: "google-workspace",
          scopes: IDENTITY_ONLY_SCOPES,
        },
      ]
    );
    const res = await runNoActivationFollowup(dbMock, { now: NOW });
    expect(res).toEqual({ eligible: 1, sent: 1, failed: 0 });
    expect(sendTpl).toHaveBeenCalledTimes(1);
    expect(sendTpl).toHaveBeenCalledWith(
      BREVO_TEMPLATE_FOLLOWUP_PERMISSIONS,
      "real@user.com",
      {
        FIRSTNAME: "Real",
        MISSING_SERVICES:
          "Gmail, Drive, Calendar, Docs, Sheets, Slides, Contacts and Tasks",
      }
    );
    // Both directions, so a branch that collapses into one template is red
    // whichever way it collapses. The config-snippet template is the one
    // that went to these users before this branch; it must never be sent
    // from here again.
    for (const wrong of [
      BREVO_TEMPLATE_NO_ACTIVATION,
      BREVO_TEMPLATE_FOLLOWUP_TRY_THIS,
      BREVO_TEMPLATE_FOLLOWUP_CONNECT,
    ]) {
      expect(sendTpl).not.toHaveBeenCalledWith(
        wrong,
        expect.anything(),
        expect.anything()
      );
    }
  });

  it("never sends the config-snippet template from any branch", async () => {
    seed(
      [
        { id: "u1", email: "a@user.com", name: "A" },
        { id: "u2", email: "b@user.com", name: "B" },
        { id: "u3", email: "c@user.com", name: "C" },
      ],
      [
        { userId: "u2", service: "google-workspace", scopes: IDENTITY_ONLY_SCOPES },
        { userId: "u3", service: "google-workspace", scopes: FULL_SCOPES },
      ]
    );
    await runNoActivationFollowup(dbMock, { now: NOW });
    const ids = sendTpl.mock.calls.map((c) => c[0]);
    expect(ids).toHaveLength(3);
    expect(ids).not.toContain(BREVO_TEMPLATE_NO_ACTIVATION);
  });

  it("sends the TRY-THIS template on a complete grant", async () => {
    seed(
      [{ id: "u1", email: "real@user.com", name: "Real" }],
      [{ userId: "u1", service: "google-workspace", scopes: FULL_SCOPES }]
    );
    await runNoActivationFollowup(dbMock, { now: NOW });
    expect(sendTpl).toHaveBeenCalledTimes(1);
    expect(sendTpl).toHaveBeenCalledWith(
      BREVO_TEMPLATE_FOLLOWUP_TRY_THIS,
      "real@user.com",
      { FIRSTNAME: "Real" }
    );
  });

  it("sends exactly ONE email per user however their state reads", async () => {
    seed(
      [
        { id: "u1", email: "a@user.com", name: "A" },
        { id: "u2", email: "b@user.com", name: "B" },
        { id: "u3", email: "c@user.com", name: "C" },
      ],
      [
        { userId: "u2", service: "google-workspace", scopes: IDENTITY_ONLY_SCOPES },
        { userId: "u3", service: "google-workspace", scopes: FULL_SCOPES },
      ]
    );
    const res = await runNoActivationFollowup(dbMock, { now: NOW });
    expect(res).toEqual({ eligible: 3, sent: 3, failed: 0 });
    expect(sendTpl).toHaveBeenCalledTimes(3);
    const perRecipient = sendTpl.mock.calls.map((c) => c[1]);
    expect(new Set(perRecipient).size).toBe(3);
  });

  it("claims BEFORE it sends, so a send that throws cannot be retried", async () => {
    // The ordering guard: the claim must already have run by the time the
    // send is attempted. A branch computed first and claimed afterwards
    // would let a crash here leave the user re-eligible, and the next run
    // would send a second follow-up.
    const order: string[] = [];
    returning.mockImplementation(async () => {
      order.push("claim");
      return [{ id: "u1" }];
    });
    sendTpl.mockImplementation(async () => {
      order.push("send");
      return true;
    });
    seed(
      [{ id: "u1", email: "real@user.com", name: "Real" }],
      [
        {
          userId: "u1",
          service: "google-workspace",
          scopes: IDENTITY_ONLY_SCOPES,
        },
      ]
    );
    await runNoActivationFollowup(dbMock, { now: NOW });
    expect(order).toEqual(["claim", "send"]);
  });

  it("launch cutoff protects the pre-launch campaign cohort", () => {
    expect(LIFECYCLE_LAUNCH.toISOString()).toBe("2026-07-17T22:00:00.000Z");
  });
});
