import { describe, expect, it } from "vitest";
import { handleContacts } from "./contacts.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";
import { throwApiError } from "../google-api/direct-transport.js";

describe("contacts_update sends the person etag (SCRUM-319)", () => {
  it("reads the person first and puts its etag in the update body", async () => {
    // updateContact answers 400 for a body with no etag, so every update
    // failed until the read was added.
    const { client, calls } = fakeClient([
      { data: { resourceName: "people/c1", etag: "%EgUBAgMuNxo" } },
      { data: { resourceName: "people/c1", etag: "%EgUBAgMuNyI" } },
    ]);

    const result = await handleContacts(client, "contacts_update", {
      resource_name: "people/c1",
      email: "new@example.com",
      title: "Engineer",
    });

    expect(calls).toEqual([
      {
        service: "people",
        resource: "people",
        method: "get",
        params: {
          resourceName: "people/c1",
          personFields: "emailAddresses,organizations",
        },
      },
      {
        service: "people",
        resource: "people",
        method: "updateContact",
        params: {
          resourceName: "people/c1",
          updatePersonFields: "emailAddresses,organizations",
        },
        jsonBody: {
          etag: "%EgUBAgMuNxo",
          emailAddresses: [{ value: "new@example.com" }],
          organizations: [{ name: undefined, title: "Engineer" }],
        },
      },
    ]);
    expect(payload(result)).toEqual({ resourceName: "people/c1", etag: "%EgUBAgMuNyI" });
  });

  it("surfaces a failed read and sends no update", async () => {
    const { client, calls } = fakeClient([{ throws: "Requested entity was not found." }]);

    await expect(
      handleContacts(client, "contacts_update", { resource_name: "people/c1", name: "Ada Lovelace" })
    ).rejects.toThrow("Requested entity was not found.");

    expect(calls.map((c) => c.method)).toEqual(["get"]);
  });

  it("refuses to update when the read returns no etag", async () => {
    const { client, calls } = fakeClient([{ data: { resourceName: "people/c1" } }]);

    await expect(
      handleContacts(client, "contacts_update", { resource_name: "people/c1", phone: "555 0100" })
    ).rejects.toThrow(/etag/);

    expect(calls.map((c) => c.method)).toEqual(["get"]);
  });
});

/** The text the transport throws for a Google error body, taken from the
 * transport itself so the test cannot drift from what a handler really sees. */
function transportError(status: number, body: unknown): string {
  try {
    throwApiError(status, JSON.stringify(body));
  } catch (err) {
    return (err as Error).message;
  }
}

/** Google's answer when the token lacks the directory scope, in both of its
 * error formats: the newer one names the reason in `details`, the older one
 * in `errors`. The transport keeps whichever it finds as `reason`. */
const SCOPE_403_DETAILS = transportError(403, {
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    status: "PERMISSION_DENIED",
    details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }],
  },
});
const SCOPE_403_ERRORS = transportError(403, {
  error: {
    code: 403,
    message: "Request had insufficient authentication scopes.",
    errors: [{ message: "Insufficient Permission", domain: "global", reason: "insufficientPermissions" }],
    status: "PERMISSION_DENIED",
  },
});

const search = (client: Parameters<typeof handleContacts>[0]) =>
  handleContacts(client, "contacts_directory_search", { query: "ada" });

async function thrownBy(p: Promise<unknown>): Promise<string> {
  try {
    await p;
  } catch (err) {
    return (err as Error).message;
  }
  throw new Error("expected the call to throw");
}

describe("contacts_directory_search without directory access (SCRUM-422)", () => {
  it.each([
    ["details reason", SCOPE_403_DETAILS],
    ["errors reason", SCOPE_403_ERRORS],
  ])("answers a scope-insufficient 403 (%s) in plain words", async (_label, raw) => {
    const { client } = fakeClient([{ throws: raw }]);
    const message = await thrownBy(search(client));

    expect(message).toMatch(/Google Workspace feature/);
    expect(message).toMatch(/personal Gmail accounts have no directory/i);
    expect(message).toMatch(/does not include directory access/);
    // None of Google's raw JSON reaches the user.
    expect(message).not.toContain("API error");
    expect(message).not.toContain("{");
    expect(message).not.toContain("PERMISSION_DENIED");
    // The gateway replaces any error matching Google's insufficient-scope
    // shapes with a "reconnect" message (SCOPE_ERROR_PATTERNS in the
    // gateway's scope-grant.ts). Reconnecting cannot help here, since the
    // directory scope is never requested, so the words must not match it.
    expect(message).not.toMatch(/insufficient authentication scopes|ACCESS_TOKEN_SCOPE_INSUFFICIENT|insufficientPermissions/i);
    // Read by end users; this repo's copy carries no em-dashes.
    expect(message).not.toContain(String.fromCharCode(0x2014));
    // No promise of a fix: reconnecting does not add the scope today.
    expect(message).not.toMatch(/reconnect|try again|soon/i);
  });

  it("leaves a 500 as it was", async () => {
    const raw = transportError(500, { error: { code: 500, message: "Internal error encountered.", status: "INTERNAL" } });
    const { client } = fakeClient([{ throws: raw }]);
    expect(await thrownBy(search(client))).toBe(raw);
  });

  it("leaves a 403 with a different reason as it was", async () => {
    const raw = transportError(403, {
      error: { code: 403, message: "The caller does not have permission", status: "PERMISSION_DENIED" },
    });
    const { client } = fakeClient([{ throws: raw }]);
    expect(await thrownBy(search(client))).toBe(raw);
  });

  it("leaves the same 403 on another contacts tool as it was", async () => {
    const { client } = fakeClient([{ throws: SCOPE_403_DETAILS }]);
    const message = await thrownBy(handleContacts(client, "contacts_search", { query: "ada" }));
    expect(message).toBe(SCOPE_403_DETAILS);
  });
});
