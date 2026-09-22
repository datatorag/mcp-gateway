import type { TestCase } from "../types";
import { resultJson } from "../result-json";

type Person = { resourceName?: string; names?: { givenName?: string; familyName?: string }[] };

/**
 * CO1 (Contacts scenario): a contact is made, renamed, then removed.
 *
 * THE RECORD IS A REAL CONTACT in a real account, so the marker is in the
 * GIVEN name where a person scanning their contacts will see it, and the
 * unique token is in the family name because `buildPersonBody` splits the
 * `name` argument on spaces and that is the half this case controls.
 *
 * DELETION IS VERIFIED BY A REFUSED GET, not by the delete's own answer:
 * `contacts_delete` replies with a sentence. A get by resource name is the
 * right check here rather than a listing, because it addresses the record
 * directly and cannot be confused by paging or by an index that lags.
 *
 * NOTHING IDENTIFYING IS PRINTED. A resource name identifies a record in
 * somebody's address book, so the evidence carries lengths and counts.
 *
 * EXPECT THIS TO GO RED AT THE RENAME UNTIL SCRUM-319 IS FIXED, and read
 * that red as the finding it is rather than as a fault in this step.
 * `contacts_update` cannot work for any caller: Google's
 * `people.updateContact` requires the person's `etag` from the most recent
 * read and the connector never sends one. Confirmed live against a throwaway
 * contact, which answered `400 Request must set person.etag`.
 *
 * The case is deliberately NOT written around it. A step that tolerated the
 * rename failing would cover `contacts_update` while proving it works when
 * it does not, which is worse than a red that names the gap.
 */
export const co1ContactsLifecycle: TestCase = {
  id: "CO1",
  title: "a contact is created, renamed, and deleted, and a later get is refused",
  covers: [
    "gws-mcp__contacts_create",
    "gws-mcp__contacts_get",
    "gws-mcp__contacts_update",
    "gws-mcp__contacts_delete",
  ],
  accounts: ["sender"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const token = `CO1-${ctx.stamp}`;
    const renamedToken = `CO1-renamed-${ctx.stamp}`;

    const created = resultJson<Person>(
      "contacts_create",
      await ctx.call("gws-mcp__contacts_create", { name: `[smoke] ${token}` }, { as: "sender" })
    );
    const resource_name = created.resourceName;
    if (!resource_name) throw new Error("contacts_create answered without a resourceName, so the contact cannot be read or removed");

    let deleted = false;
    ctx.defer("delete the created contact", async () => {
      if (deleted) return;
      const gone = await ctx.call("gws-mcp__contacts_delete", { resource_name }, { as: "sender" });
      if (gone.isError) ctx.evidence("RESIDUE: the created contact could not be deleted and is still in the address book");
    });

    const familyOf = (p: Person) => p.names?.[0]?.familyName ?? "";

    const afterCreate = resultJson<Person>(
      "contacts_get",
      await ctx.call("gws-mcp__contacts_get", { resource_name }, { as: "sender" })
    );
    if (afterCreate.resourceName !== resource_name) {
      throw new Error("contacts_get answered about a different record than the one created");
    }
    if (familyOf(afterCreate) !== token) {
      throw new Error("the created contact is stored under a different name than it was created with");
    }

    const updated = await ctx.call(
      "gws-mcp__contacts_update",
      { resource_name, name: `[smoke] ${renamedToken}` },
      { as: "sender" }
    );
    if (updated.isError) throw new Error("contacts_update refused the rename, so there is nothing to re-read");

    const afterUpdate = resultJson<Person>(
      "contacts_get",
      await ctx.call("gws-mcp__contacts_get", { resource_name }, { as: "sender" })
    );
    if (familyOf(afterUpdate) === token) {
      throw new Error("the contact still carries its original name, so the rename did not reach Google");
    }
    if (familyOf(afterUpdate) !== renamedToken) {
      throw new Error("the renamed contact carries neither the name it was created with nor the one it was renamed to");
    }
    ctx.evidence(`the stored name changed, ${token.length} characters to ${renamedToken.length}`);

    const removed = await ctx.call("gws-mcp__contacts_delete", { resource_name }, { as: "sender" });
    if (removed.isError) throw new Error("contacts_delete refused, so the contact is still in the address book");

    /* A REFUSED GET IS THE PROOF. Asserting only that the delete answered
     * would pass against a handler that reported success without issuing
     * the request, which is the failure this ordering exists to catch. */
    const after = await ctx.call("gws-mcp__contacts_get", { resource_name }, { as: "sender" });
    if (!after.isError) {
      throw new Error("the deleted contact can still be fetched by resource name, so the delete was reported rather than made");
    }
    deleted = true;
    ctx.evidence("a get of the deleted contact is refused");
  },
};
