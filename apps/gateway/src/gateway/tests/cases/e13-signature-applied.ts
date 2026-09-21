import type { TestCase } from "../types";
import { firstArray, resultJson, resultText } from "../result-json";
import { countSignatureBlocks, isMultipartAlternative, partText, type MailPart } from "../mail-parts";

/**
 * E13 (smoke row E13): the signature is applied on send, ONCE, and
 * in the HTML part only.
 *
 * Guards SCRUM-278, which came from a customer report that mail our
 * connector sent carried no signature. Four claims, and each one is a
 * different way the feature has been or could be wrong:
 *
 *  - the send SAYS it applied one, so a caller can tell;
 *  - a plain-body send is promoted to multipart/alternative, because a
 *    signature is HTML and there is nowhere else to put it;
 *  - the HTML part carries EXACTLY ONE signature block, counted rather than
 *    checked for presence, because signing twice is the failure that
 *    appending in two places produces;
 *  - the plain-text part carries the token and NO signature text, which is
 *    the 2026-09-17 HTML-only ruling.
 *
 * The expected signature text is read from the account's own settings once
 * per run and never hardcoded: it is a real person's sign-off, it changes,
 * and this repository is public. That read is the one path permitted under
 * `settings` (HQ, 2026-09-20), and it is a read: it cannot send anything,
 * which is what the rest of that denylist is for.
 */
export const e13SignatureApplied: TestCase = {
  id: "E13",
  title: "a send applies the signature once, in the HTML part only",
  covers: ["gws-mcp__gmail_send", "gws-mcp__gmail_search", "gws-mcp__gws_run"],
  accounts: ["sender", "reader"],
  timeoutMs: 240_000,
  run: async (ctx) => {
    const token = `token-${ctx.stamp}`;

    /** The stored sign-off, from the account's own settings. */
    const needle = await (async () => {
      const res = await ctx.call(
        "gws-mcp__gws_run",
        { service: "gmail", resource: "users.settings.sendAs", method: "list", params: { userId: "me" } },
        { as: "sender" }
      );
      const rows = (firstArray(resultJson("gws_run", res)) ?? []) as {
        isDefault?: boolean;
        signature?: string;
      }[];
      const stored = (rows.find((r) => r.isDefault)?.signature ?? rows[0]?.signature ?? "").trim();
      ctx.evidence(`the stored signature is ${stored.length} characters`);
      if (stored === "") {
        throw new Error("the sending account has no stored signature, so nothing below can be concluded");
      }
      /* Compared by a distinctive WORD rather than the whole block: Gmail
       * rewrites the wrapper markup on the way out, so the stored html and
       * the delivered html are not equal even when the signature is right.
       * The text is what a reader sees and what the customer report was
       * about. Never recorded in evidence: it is a person's sign-off. */
      const [first] = stored.replace(/<[^>]+>/g, " ").match(/[A-Za-z]{4,}/g) ?? [];
      if (!first) {
        throw new Error("the stored signature has no word long enough to match on");
      }
      return first;
    })();

    /** Sends, waits for delivery, returns the full payload. Used twice. */
    const sendAndRead = async (suffix: string, extra: Record<string, unknown>) => {
      const subject = `[smoke] E13 ${suffix} ${ctx.stamp}`;
      const sent = await ctx.call(
        "gws-mcp__gmail_send",
        { to: ctx.address("reader"), subject, body: `Signature check. ${token}`, ...extra },
        { as: "sender" }
      );
      const sentId = resultJson<{ id?: string }>("gmail_send", sent).id;
      if (sentId) {
        ctx.defer(`trash the sent copy (${suffix})`, async () => {
          if (!(await ctx.trashOwnMessage(sentId, { as: "sender" }))) {
            ctx.evidence("RESIDUE: a sent copy could not be trashed");
          }
        });
      }

      const id = await ctx.until(
        `the ${suffix} message to arrive`,
        async () => {
          const found = await ctx.call(
            "gws-mcp__gmail_search",
            { query: `subject:"E13 ${suffix} ${ctx.stamp}"`, max_results: 5 },
            { as: "reader" }
          );
          return ((firstArray(resultJson("gmail_search", found)) ?? []) as { id?: string }[]).find((h) => h.id)?.id;
        },
        { everyMs: 5_000, forMs: 120_000 }
      );
      ctx.defer(`trash the received message (${suffix})`, async () => {
        if (!(await ctx.trashOwnMessage(id, { as: "reader" }))) {
          ctx.evidence("RESIDUE: a received message could not be trashed");
        }
      });

      const full = resultJson<{ payload?: MailPart }>(
        "gws_run",
        await ctx.call(
          "gws-mcp__gws_run",
          {
            service: "gmail",
            resource: "users.messages",
            method: "get",
            params: { userId: "me", id, format: "full" },
          },
          { as: "reader" }
        )
      );
      return { answer: resultText(sent), payload: full.payload };
    };

    // 1. A PLAIN BODY, no html_body.
    const plain = await sendAndRead("plain", {});
    if (!/appl/i.test(plain.answer)) {
      throw new Error("the send does not report the signature as applied, so a caller cannot tell it happened");
    }
    if (!isMultipartAlternative(plain.payload)) {
      throw new Error("a plain send carrying a signature was not promoted to multipart/alternative, so the signature has nowhere to live");
    }
    const html = partText(plain.payload, "text/html");
    const text = partText(plain.payload, "text/plain");
    const blocks = countSignatureBlocks(html);
    ctx.evidence(`plain send: ${blocks} signature block(s) in the html part`);

    if (blocks !== 1) throw new Error(`the html part carries ${blocks} signature blocks, not one`);
    // THE ACCOUNT'S OWN SIGNATURE, not merely a signature. A structurally
    // applied but empty block would satisfy a count and deliver nothing,
    // which is what the customer reported in the first place.
    if (!html.includes(needle)) {
      throw new Error("the html part's signature block does not carry the account's stored signature");
    }
    if (!text.includes(token)) throw new Error("the plain part does not carry the token");
    if (text.includes(needle) || /gmail_signature/.test(text)) {
      throw new Error("the plain-text part carries the signature, which the HTML-only ruling forbids");
    }

    // 2. THE SAME SEND WITH AN HTML BODY. The signature must sit inside the
    // body it was given, once, rather than being appended after it.
    const rich = await sendAndRead("html", { html_body: `<p>Signature check. ${token}</p>` });
    const richHtml = partText(rich.payload, "text/html");
    const richBlocks = countSignatureBlocks(richHtml);
    ctx.evidence(`html send: ${richBlocks} signature block(s)`);

    if (richBlocks !== 1) throw new Error(`the html send carries ${richBlocks} signature blocks, not one`);
    const closing = richHtml.toLowerCase().lastIndexOf("</body>");
    if (closing !== -1) {
      const marker = richHtml.toLowerCase().search(/class\s*=\s*["'][^"']*gmail_signature/i);
      if (marker > closing) {
        throw new Error("the signature block sits after </body>, so a client may not render it");
      }
    }
  },
};
