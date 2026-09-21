import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * DR2 (Drive scenario): reading a Google Doc through Drive returns that
 * document's text.
 *
 * WHAT THESE TWO TOOLS SHARE, checked in the plugin rather than assumed,
 * because five earlier versions of this case assumed otherwise:
 * `drive_read_file` routes a `GOOGLE_DOC` mime type to `readDocText`, which
 * it imports from the docs module; `docs_get` with `mode: "text"` reaches
 * `textOf(docRuns(data))` on the same `documents.get` response. The two
 * strings are therefore EQUAL BY CONSTRUCTION, and equality is what this
 * case asserts.
 *
 * WHAT THAT CAN AND CANNOT CATCH, stated because the previous versions of
 * this file got it exactly backwards:
 *
 *  - it CANNOT catch a reader returning a metadata envelope instead of the
 *    body. That reader cannot arise here: the Google Doc branch returns the
 *    extractor's string and nothing else.
 *  - it CAN catch the failures that can arise, which are all about routing:
 *    a read of the wrong id, a mime lookup that sends the file down the
 *    sheet, slides or office-conversion branch, an error object in place of
 *    content, an empty body, and any future divergence between the two
 *    extractors, which today are one function.
 *
 * FIVE VERSIONS BUILT A SELECTOR FOR AN ADVERSARY THAT CANNOT EXIST HERE.
 * Each was defeated by a new shape of metadata echo, and each fix was
 * aimed at the shape rather than at the question of whether such a reader
 * was reachable at all. Reading the two handlers, which takes a minute,
 * would have replaced all of it with one equality. The lesson is the order:
 * establish what the code under test actually does before designing an
 * assertion against it.
 */
export const dr2DriveRead: TestCase = {
  id: "DR2",
  title: "reading the fixture doc through Drive returns the same text docs_get returns",
  covers: ["gws-mcp__drive_read_file", "gws-mcp__docs_get"],
  accounts: ["sender"],
  fixtures: ["doc"],
  run: async (ctx) => {
    const file_id = ctx.fixture("doc");

    /* `mode: "text"` is passed rather than relied on. The plugin defaults
     * to it and every sibling states it; a case resting on an unstated
     * default dies with a red about Drive when the default moves. */
    const doc = resultJson<{ text?: string }>(
      "docs_get",
      await ctx.call("gws-mcp__docs_get", { document_id: file_id, mode: "text" }, { as: "sender" })
    );
    const drive = resultJson<{ content?: string }>(
      "drive_read_file",
      await ctx.call("gws-mcp__drive_read_file", { file_id }, { as: "sender" })
    );

    const text = doc.text ?? "";
    const content = typeof drive.content === "string" ? drive.content : "";
    ctx.evidence(`docs_get returned ${text.length} characters, drive_read_file ${content.length}`);

    /* EMPTY IS CHECKED FIRST, and on the docs side too. Two empty strings
     * are equal, so an equality check alone would pass a run in which
     * neither tool returned anything. */
    if (text.trim() === "") {
      throw new Error("the fixture doc has no text through docs_get, so there is nothing to compare against");
    }
    if (content.trim() === "") {
      throw new Error("drive_read_file returned no content for a document docs_get can read");
    }

    if (content !== text) {
      /* LENGTHS AND A POSITION, NEVER THE STRINGS. This message becomes a
       * row of `test_results.evidence`, and that scrub removes addresses,
       * keys and long id runs but not prose, so a document's body put here
       * would be stored and rendered verbatim. Evidence records shapes and
       * comparisons, not payloads. A position is enough to start on: the
       * two come from one extractor, so the only question is where they
       * parted.
       *
       * Compared over the SHORTER of the two, by code unit on both sides.
       * An earlier version walked the code POINTS of one string against the
       * code UNITS of the other, which one astral character ahead of the
       * divergence was enough to shift, and which answered -1 whenever the
       * docs text was a prefix of the drive content: that is the case of
       * Drive returning MORE, which is a divergence worth naming rather
       * than reporting as index minus one. */
      const shared = Math.min(content.length, text.length);
      let at = -1;
      for (let i = 0; i < shared; i++) {
        if (content[i] !== text[i]) {
          at = i;
          break;
        }
      }
      const where =
        at === -1
          ? `they agree for all ${shared} shared characters, so one is a prefix of the other`
          : `first differing at index ${at}`;
      throw new Error(
        `drive_read_file and docs_get returned different text for the same document (${content.length} vs ${text.length} characters, ${where}); they share one extractor, so this is either a routing fault or the two have diverged`
      );
    }
  },
};
