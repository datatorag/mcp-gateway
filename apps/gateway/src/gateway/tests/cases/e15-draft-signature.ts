import type { TestCase } from "../types";
import { firstArray, resultJson, resultText } from "../result-json";
import { countSignatureBlocks, partText, type MailPart } from "../mail-parts";

/**
 * E15 (smoke row E15): a draft is signed WHEN WRITTEN, and sending
 * it never signs it twice.
 *
 * Guards SCRUM-291, from the customer flow "Claude drafts, I send it myself
 * from Gmail". That flow only works if the signature is already in the
 * draft, which means the send path has to recognise one that is there and
 * leave it alone. Signing on both write and send is the obvious failure and
 * produces a message with two sign-offs; it is caught here by COUNTING,
 * because a presence check cannot tell one from two.
 *
 * Four steps, and the fourth is the interesting one: sending an unsigned
 * draft must still sign it, so the flag suppresses at write time without
 * permanently marking the draft as unsignable.
 */
export const e15DraftSignature: TestCase = {
  id: "E15",
  title: "a draft is signed once when written and is not signed again on send",
  covers: [
    "gws-mcp__gmail_create_draft",
    "gws-mcp__gmail_update_draft",
    "gws-mcp__gmail_send_draft",
    // Cleanup deletes a draft that was never sent.
    "gws-mcp__gmail_delete_draft",
    "gws-mcp__gmail_search",
    "gws-mcp__gws_run",
  ],
  accounts: ["sender", "reader"],
  timeoutMs: 300_000,
  run: async (ctx) => {
    const to = ctx.address("reader");
    const subject = `[smoke] E15 ${ctx.stamp}`;

    /** A draft's stored html, through format=full: the flattened view has
     * already chosen a part, and the claim here is about which part. */
    const draftHtml = async (draftId: string) => {
      const res = await ctx.call(
        "gws-mcp__gws_run",
        {
          service: "gmail",
          resource: "users.drafts",
          method: "get",
          params: { userId: "me", id: draftId, format: "full" },
        },
        { as: "sender" }
      );
      const body = resultJson<{ message?: { payload?: MailPart }; payload?: MailPart }>("gws_run", res);
      const payload = body.message?.payload ?? body.payload;
      return partText(payload, "text/html");
    };

    // 1. A DRAFT WITH A BODY ONLY is signed once.
    const created = await ctx.call(
      "gws-mcp__gmail_create_draft",
      { to, subject, body: `Drafted by the smoke suite. draft-${ctx.stamp}` },
      { as: "sender" }
    );
    const signedDraft = resultJson<{ id?: string; draftId?: string }>("gmail_create_draft", created).id
      ?? resultJson<{ draftId?: string }>("gmail_create_draft", created).draftId;
    if (!signedDraft) throw new Error("gmail_create_draft returned no id");
    let signedSent = false;
    ctx.defer("delete the signed draft if it was never sent", async () => {
      if (signedSent) return;
      await ctx.call("gws-mcp__gmail_delete_draft", { draft_id: signedDraft }, { as: "sender" });
    });

    if (!/appl/i.test(resultText(created))) {
      throw new Error("creating a draft does not report the signature as applied");
    }
    const afterCreate = countSignatureBlocks(await draftHtml(signedDraft));
    ctx.evidence(`after create: ${afterCreate} signature block(s)`);
    if (afterCreate !== 1) throw new Error(`a new draft carries ${afterCreate} signature blocks, not one`);

    // 2. UPDATING IT MUST NOT ADD A SECOND.
    await ctx.call(
      "gws-mcp__gmail_update_draft",
      { draft_id: signedDraft, to, subject, body: `Edited by the smoke suite. draft-${ctx.stamp}` },
      { as: "sender" }
    );
    const afterUpdate = countSignatureBlocks(await draftHtml(signedDraft));
    ctx.evidence(`after update: ${afterUpdate} signature block(s)`);
    if (afterUpdate !== 1) {
      throw new Error(`the draft carries ${afterUpdate} signature blocks after an edit, not one`);
    }

    // 3. signature false AT WRITE TIME leaves none.
    const unsignedCreated = await ctx.call(
      "gws-mcp__gmail_create_draft",
      { to, subject, body: `Unsigned draft. draft-${ctx.stamp}`, signature: false },
      { as: "sender" }
    );
    const unsignedDraft = resultJson<{ id?: string; draftId?: string }>("gmail_create_draft", unsignedCreated).id
      ?? resultJson<{ draftId?: string }>("gmail_create_draft", unsignedCreated).draftId;
    if (!unsignedDraft) throw new Error("the unsigned gmail_create_draft returned no id");
    let unsignedSent = false;
    ctx.defer("delete the unsigned draft if it was never sent", async () => {
      if (unsignedSent) return;
      await ctx.call("gws-mcp__gmail_delete_draft", { draft_id: unsignedDraft }, { as: "sender" });
    });
    const unsignedBlocks = countSignatureBlocks(await draftHtml(unsignedDraft));
    ctx.evidence(`unsigned draft: ${unsignedBlocks} signature block(s)`);
    if (unsignedBlocks !== 0) {
      throw new Error(`a draft written with signature false carries ${unsignedBlocks} signature blocks`);
    }

    /** Sends a draft and returns the delivered message's html. */
    const sendAndRead = async (draftId: string, label: string) => {
      const sent = await ctx.call("gws-mcp__gmail_send_draft", { draft_id: draftId }, { as: "sender" });
      const id = await ctx.until(
        `the ${label} draft to arrive`,
        async () => {
          const found = await ctx.call(
            "gws-mcp__gmail_search",
            { query: `subject:"${ctx.stamp}"`, max_results: 10 },
            { as: "reader" }
          );
          const hits = (firstArray(resultJson("gmail_search", found)) ?? []) as { id?: string }[];
          for (const hit of hits) {
            if (!hit.id || seen.has(hit.id)) continue;
            return hit.id;
          }
          return undefined;
        },
        { everyMs: 5_000, forMs: 120_000 }
      );
      seen.add(id);
      ctx.defer(`trash the ${label} message`, async () => {
        if (!(await ctx.trashOwnMessage(id, { as: "reader" }))) {
          ctx.evidence("RESIDUE: a received message could not be trashed");
        }
      });
      const full = resultJson<{ payload?: MailPart }>(
        "gws_run",
        await ctx.call(
          "gws-mcp__gws_run",
          { service: "gmail", resource: "users.messages", method: "get", params: { userId: "me", id, format: "full" } },
          { as: "reader" }
        )
      );
      return { answer: resultText(sent), html: partText(full.payload, "text/html") };
    };
    const seen = new Set<string>();

    // 4a. SENDING THE SIGNED DRAFT must not sign it again.
    const signed = await sendAndRead(signedDraft, "signed");
    signedSent = true;
    const signedBlocks = countSignatureBlocks(signed.html);
    ctx.evidence(`delivered signed draft: ${signedBlocks} signature block(s)`);
    if (signedBlocks !== 1) {
      throw new Error(`the delivered message carries ${signedBlocks} signature blocks, so sending signed it again`);
    }
    if (!/already|present/i.test(signed.answer)) {
      throw new Error("sending a signed draft does not report the signature as already present");
    }

    // 4b. SENDING THE UNSIGNED DRAFT must sign it at send.
    const unsigned = await sendAndRead(unsignedDraft, "unsigned");
    unsignedSent = true;
    const unsignedDelivered = countSignatureBlocks(unsigned.html);
    ctx.evidence(`delivered unsigned draft: ${unsignedDelivered} signature block(s)`);
    if (unsignedDelivered !== 1) {
      throw new Error(`the delivered unsigned draft carries ${unsignedDelivered} signature blocks, not one`);
    }
    if (!/appl/i.test(unsigned.answer)) {
      throw new Error("sending an unsigned draft does not report the signature as applied");
    }
  },
};
