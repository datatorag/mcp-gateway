import type { TestCase } from "../types";
import { firstArray, resultJson, resultText } from "../result-json";

type Attachment = { id?: string; title?: string; version?: number | null; mediaType?: string | null; fileSize?: number | null; downloadLink?: string | null };

/**
 * CF4 (Confluence scenario): the attachment endpoint finds the file the
 * space says is there.
 *
 * `confluence_get_attachment` TAKES A FILENAME, which is the whole problem
 * this step had to solve. It lists a page's attachments and filters client
 * side on `title === filename`, so the caller must already know the exact
 * name. The fixture's attachment was uploaded by hand and its name contains
 * a character that does not survive being retyped, so a literal here would
 * be wrong in a way nobody could see: it would look like a filename and
 * match nothing.
 *
 * SO THE NAME IS DERIVED, NEVER WRITTEN. A CQL search for attachments whose
 * container is the fixture page reports the title, and that title is handed
 * straight to `confluence_get_attachment`. Two sources, a v1 search and a
 * v2 attachments listing, agreeing on one record.
 *
 * WHAT CARRIES THAT AGREEMENT IS THE MISS SENTENCE BELOW, not a comparison
 * of titles. The tool filters on `title === filename`, so asking whether the
 * record it returned has the title it filtered for is true by construction;
 * an earlier revision of this case asserted exactly that and credited it
 * with the cross-check. The real claim is that the v2 listing DID contain
 * what the v1 search named, and the only way it can fail is the miss.
 *
 * A MISS ANSWERS WITH PROSE, NOT AN ERROR: the tool returns
 * `No attachment named "..." found on page ...` as a text response, so
 * `isError` is false and a case that only checked for an error would read a
 * miss as a hit. The check is therefore that the answer PARSES and carries
 * the id and title, and the miss sentence is caught explicitly so its red
 * says which of the two failed.
 *
 * NO FILENAME IS PRINTED. It names a file on our own Confluence, and the
 * derived title is compared against what the other endpoint returns rather
 * than against anything in this repo.
 */
export const cf4ConfluenceAttachment: TestCase = {
  id: "CF4",
  title: "an attachment named by a CQL search is found by the attachment endpoint",
  covers: ["atlassian-mcp__confluence_search", "atlassian-mcp__confluence_get_attachment"],
  accounts: ["atlassian"],
  fixtures: ["confluenceAttachmentPage"],
  timeoutMs: 120_000,
  run: async (ctx) => {
    const page_id = ctx.fixture("confluenceAttachmentPage");

    /* NO `?? []`. An unreadable search response would have become "0 rows"
     * and the red below would have told somebody to attach a file to a page
     * that already has one. */
    const searched = firstArray(
      resultJson(
        "confluence_search",
        await ctx.call(
          "atlassian-mcp__confluence_search",
          { cql: `type=attachment and container=${page_id}`, limit: 10 },
          { as: "atlassian" }
        )
      )
    );
    if (searched === null) {
      throw new Error("confluence_search answered without a list anywhere in it, so no attachment can be named from it");
    }
    const found = searched as { id?: string; title?: string }[];
    ctx.evidence(`the CQL search reports ${found.length} attachment(s) on the fixture page`);

    // A FIXTURE PROBLEM, named as one: the file is attached by hand.
    const named = found.find((a) => a.title);
    if (!named?.title) {
      throw new Error(
        `the CQL search found no attachment with a title on the fixture page (${found.length} row(s)); attach a small file to the fixture page`
      );
    }

    const answer = await ctx.call(
      "atlassian-mcp__confluence_get_attachment",
      { page_id, filename: named.title },
      { as: "atlassian" }
    );

    /* THE MISS SENTENCE, caught before parsing, because it is a successful
     * response carrying a refusal and `resultJson` would report it as "did
     * not answer JSON", which names the wrong problem. */
    if (!answer.isError && /^No attachment named/.test(resultText(answer).trim())) {
      throw new Error(
        "the attachment endpoint did not find the file the CQL search had just named, so the two disagree about what is on the page"
      );
    }

    /* ONE RECORD, NOT A LIST. The tool answers with an ARRAY when a page
     * carries several attachments of the same name, and every field read
     * below would then be undefined; without this the red would talk about
     * a missing id and never mention the duplicate that caused it. */
    const parsed = resultJson<Attachment | Attachment[]>("confluence_get_attachment", answer);
    if (Array.isArray(parsed)) {
      throw new Error(
        `the attachment endpoint answered with ${parsed.length} records for one filename, so the fixture page carries duplicates of that name`
      );
    }
    const direct = parsed;
    if (!direct.id) {
      throw new Error("the attachment came back without an id, so it cannot be addressed");
    }
    if (typeof direct.downloadLink !== "string" || direct.downloadLink === "") {
      throw new Error("the attachment carries no download link, so there is no way to fetch the file it describes");
    }
    ctx.evidence(
      `both endpoints agree on one attachment of ${String(direct.title ?? "").length} title characters, media type present: ${direct.mediaType != null}`
    );
  },
};
