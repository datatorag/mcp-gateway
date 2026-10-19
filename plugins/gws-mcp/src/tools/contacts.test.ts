import { describe, expect, it } from "vitest";
import { handleContacts } from "./contacts.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";

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
