import type { TestCase } from "../types";

/**
 * FD5 (Drive scenario, SCRUM-428): what a Drive reference refuses, against
 * real Drive answers rather than fixtures in a unit test. A folder has no
 * content; a Google Doc asked for as a stored file is pointed at
 * drive_export; a Doc asked for in a Sheets format is told the formats it
 * takes. Each must be a refusal, so no link is made.
 */
export const fd5DriveReferenceRefusals: TestCase = {
  id: "FD5",
  title: "a folder, a Doc as a stored file, and a format a Doc cannot take are refused",
  covers: ["file_download_link"],
  accounts: ["sender"],
  fixtures: ["folder", "doc"],
  timeoutMs: 90_000,
  run: async (ctx) => {
    const account = ctx.address("sender");
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ["the fixture folder as a drive_file", { type: "drive_file", file_id: ctx.fixture("folder"), account }, /folder/],
      ["the fixture Doc as a drive_file", { type: "drive_file", file_id: ctx.fixture("doc"), account }, /drive_export/],
      ["the fixture Doc exported as xlsx", { type: "drive_export", file_id: ctx.fixture("doc"), format: "xlsx", account }, /exports as/],
    ];
    for (const [label, file, says] of cases) {
      const res = await ctx.call("file_download_link", { file });
      const text = res.content.map((c) => ("text" in c ? c.text : "")).join(" ");
      ctx.evidence(`${label}: refused ${res.isError === true}`);
      if (res.isError !== true) throw new Error(`${label} was not refused`);
      if (!says.test(text)) throw new Error(`${label} was refused without saying why in the words expected`);
      if (/\/files\/d\//.test(text)) throw new Error(`${label} was refused but the answer carries a link`);
    }
  },
};
