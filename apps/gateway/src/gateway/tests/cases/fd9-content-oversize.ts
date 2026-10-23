import type { TestCase } from "../types";

/**
 * FD9 (Drive scenario, SCRUM-437): a content reference one byte over 1 MB is
 * refused by name and size, and nothing reaches Drive.
 *
 * The call goes through the in-process client, so this pins the gateway's
 * own cap. That the transport carries a body this size for an authenticated
 * caller, and only for one, is pinned on the /mcp gate in bearer-auth.test.ts.
 */
export const fd9ContentOversize: TestCase = {
  id: "FD9",
  title: "a content reference over 1 MB is refused, and nothing reaches Drive",
  covers: ["gws-mcp__drive_upload_file"],
  accounts: ["sender"],
  fixtures: ["folder"],
  timeoutMs: 60_000,
  run: async (ctx) => {
    const base64 = Buffer.alloc(1024 * 1024 + 1, 7).toString("base64");
    const res = await ctx.call(
      "gws-mcp__drive_upload_file",
      { file: { type: "content", name: `fd9-${ctx.stamp}.bin`, base64 }, folder_id: ctx.fixture("folder") },
      { as: "sender" }
    );
    const text = res.content.map((c) => c.text ?? "").join(" ");
    ctx.evidence(`refused: ${res.isError === true}; names the cap: ${text.includes("1 MB")}`);
    if (res.isError !== true) throw new Error("a content reference over 1 MB was accepted");
    if (!text.includes("1 MB")) throw new Error("the refusal does not name the 1 MB cap");
    if (!text.includes("Nothing was uploaded")) throw new Error("the refusal does not say nothing was uploaded");
  },
};
