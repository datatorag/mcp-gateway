import type { TestCase } from "../types";
import { resultJson } from "../result-json";

/**
 * SL9 (Slack scenario): the fixture channel's files list answers in the
 * metadata shape, and never with a link that serves a file's bytes.
 *
 * Read only: the connector uploads nothing, so the list may be empty.
 */
export const sl9SlackFilesList: TestCase = {
  id: "SL9",
  title: "the fixture channel's files are listed as metadata, with no download links",
  covers: ["slack-mcp__slack_files_list"],
  accounts: ["slack"],
  fixtures: ["slackChannel"],
  run: async (ctx) => {
    const channel = ctx.fixture("slackChannel");
    const answer = resultJson<{ files?: Record<string, unknown>[] }>(
      "slack_files_list",
      await ctx.call("slack-mcp__slack_files_list", { channel, count: 10 }, { as: "slack" })
    );
    if (!Array.isArray(answer.files)) throw new Error("slack_files_list answered without a files list");
    if (answer.files.length > 10) throw new Error(`a count of 10 answered ${answer.files.length} files`);
    for (const f of answer.files) {
      if (typeof f.id !== "string") throw new Error("a file came back with no id");
      const served = Object.keys(f).filter((k) => /^url_private|^thumb_|^preview|^permalink_public/.test(k));
      if (served.length > 0) throw new Error(`a file came back with fields that serve its bytes: ${served.join(", ")}`);
    }
    ctx.evidence(`${answer.files.length} file(s) listed, metadata only`);
  },
};
