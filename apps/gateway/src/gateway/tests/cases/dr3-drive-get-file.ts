import type { TestCase } from "../types";
import { resultJson, resultText } from "../result-json";

/**
 * DR3 (Drive scenario): `drive_get_file` describes the fixture doc, places
 * it in the fixture folder, and returns none of its content.
 *
 * The folder is the assertion with teeth. `parents` is what a caller reads
 * before moving a file, and the fixture doc is known to sit in the fixture
 * folder, so a parent list that does not name that folder is wrong in a
 * way a present-and-plausible response would hide. The control heading is
 * the content check: `drive_read_file` returns it for this same file, and
 * a describe call that also returned it would be a read under another
 * name.
 */
export const dr3DriveGetFile: TestCase = {
  id: "DR3",
  title: "a file's details name it, type it and place it in its folder, without its content",
  covers: ["gws-mcp__drive_get_file", "gws-mcp__drive_read_file"],
  accounts: ["sender"],
  fixtures: ["doc", "folder"],
  run: async (ctx) => {
    const file_id = ctx.fixture("doc");
    const folder = ctx.fixture("folder");

    const answered = await ctx.call("gws-mcp__drive_get_file", { file_id }, { as: "sender" });
    const file = resultJson<{
      id?: string;
      name?: string;
      mimeType?: string;
      parents?: string[];
      modifiedTime?: string;
      webViewLink?: string;
      trashed?: boolean;
    }>("drive_get_file", answered);

    ctx.evidence(`details came back with ${Object.keys(file).length} field(s), type ${file.mimeType ?? "absent"}`);
    if (file.id !== file_id) throw new Error("the details describe a different file id than the one asked for");
    if (!file.name || file.mimeType !== "application/vnd.google-apps.document") {
      throw new Error("the fixture doc came back without a name or not typed as a Google Doc");
    }
    if (!Array.isArray(file.parents) || !file.parents.includes(folder)) {
      throw new Error("the fixture doc's parents do not name the fixture folder it is in");
    }
    if (file.trashed !== false) throw new Error("the fixture doc does not report trashed false");
    if (!file.modifiedTime || Number.isNaN(Date.parse(file.modifiedTime)) || !file.webViewLink) {
      throw new Error("the details carry no usable modified time or no link");
    }

    // NO CONTENT. The read tool returns the doc's text; none of its first
    // line may appear in the describe call's answer.
    const content = resultJson<{ content?: unknown }>(
      "drive_read_file",
      await ctx.call("gws-mcp__drive_read_file", { file_id }, { as: "sender" })
    ).content;
    const firstLine = String(typeof content === "string" ? content : JSON.stringify(content ?? ""))
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length >= 12);
    if (!firstLine) throw new Error("the fixture doc read back no line long enough to check content against");
    if (firstLine !== file.name && resultText(answered).includes(firstLine)) {
      throw new Error("the doc's own text appears in its details, so the describe call returned content");
    }
    ctx.evidence("the doc is placed in the fixture folder and none of its text came back with its details");
  },
};
