/**
 * The send guard's Slack rules (SCRUM-454).
 *
 * In a test run a Slack write may reach only the fixture channel
 * (`slackChannel`, an id from the environment), and a direct message only
 * the test user's own DM. A post or a DM notifies people the moment it
 * lands, and nothing the connector offers takes the notification back, so
 * the rule is checked before dispatch:
 *
 *  1. against `checkSend`, with each tool's argument shape;
 *  2. through the runner's own dispatch (`makeContextParts`) into the
 *     plugin's REAL `handleSlackWrite`, given a Slack client that records
 *     every method instead of calling Slack. A known-bad call is one the
 *     plugin WOULD carry out (its own expected-target check passes, because
 *     the expectation names the wrong target too), and the guard is shown to
 *     be what stops it: no Slack method is called at all.
 *
 * Every id and address here is invented.
 */

import path from "node:path";
import { pathToFileURL } from "node:url";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { checkSend, newSlackPosted, recordSlackPosted, SUBJECT_PREFIX, type SlackScope } from "./send-guard";
import { makeContextParts } from "./execute";
import { parseFixtureMap } from "./fixtures";

const STAMP = "a1b2c3d4";
const LABEL = `${SUBJECT_PREFIX} SL ${STAMP}-SL4`;

const FIXTURE_CHANNEL = "C000TEST1";
const FIXTURE_NAME = "smoke-tests";
const OTHER_CHANNEL = "C000OTHER";
const OTHER_NAME = "general";
const SELF = "runner@example.test";
const SELF_ID = "U000SELF1";
const OTHER_PERSON = "someone@example.test";
const OTHER_ID = "U000OTHR1";
const OWN_TS = "1700000000.000100";
const STRANGER_TS = "1600000000.000200";

function scope(over: Partial<SlackScope> = {}): SlackScope {
  const posted = newSlackPosted();
  posted.add(OWN_TS);
  return { channel: FIXTURE_CHANNEL, self: SELF, posted, ...over };
}

const check = (tool: string, args: Record<string, unknown>, over: Partial<{ slack: SlackScope | undefined; runStamp: string }> = {}) =>
  checkSend(`slack-mcp__${tool}`, args, {
    readerEmail: null,
    lookups: { readDraft: async () => null, readMessage: async () => null },
    runStamp: STAMP,
    slack: scope(),
    ...over,
  });

const refused = async (p: Promise<{ ok: boolean }>) => expect((await p).ok).toBe(false);
const allowed = async (p: Promise<{ ok: boolean; reason?: string }>) => {
  const verdict = await p;
  expect(verdict, (verdict as { reason?: string }).reason).toEqual({ ok: true });
};

describe("Slack in a test run: what is allowed", () => {
  it("lets every read through, whatever it names", async () => {
    for (const tool of [
      "slack_channels_list",
      "slack_messages_search",
      "slack_channel_history",
      "slack_thread_read",
      "slack_users_lookup",
      "slack_files_list",
    ]) {
      await allowed(check(tool, { channel: OTHER_CHANNEL }, { slack: undefined }));
    }
  });

  it("posts a labelled message to the fixture channel, and replies in a thread the run started", async () => {
    await allowed(check("slack_message_post", { channel: FIXTURE_CHANNEL, text: LABEL, expected_channel_name: FIXTURE_NAME }));
    await allowed(
      check("slack_message_post", { channel: FIXTURE_CHANNEL, text: LABEL, thread_ts: OWN_TS, expected_channel_name: FIXTURE_NAME })
    );
  });

  it("edits and reacts to a message the run posted there", async () => {
    await allowed(check("slack_message_update", { channel: FIXTURE_CHANNEL, ts: OWN_TS, text: LABEL, expected_channel_name: FIXTURE_NAME }));
    await allowed(check("slack_reactions_add", { channel: FIXTURE_CHANNEL, ts: OWN_TS, name: "eyes" }));
  });

  it("sends a labelled DM to the test user's own address, any case", async () => {
    await allowed(check("slack_dm_send", { user: SELF.toUpperCase(), text: LABEL, expected_user_email: SELF }));
  });
});

describe("Slack in a test run: known-bad attempts", () => {
  it("refuses a write to any channel but the fixture", async () => {
    await refused(check("slack_message_post", { channel: OTHER_CHANNEL, text: LABEL, expected_channel_name: OTHER_NAME }));
    await refused(check("slack_message_update", { channel: OTHER_CHANNEL, ts: OWN_TS, text: LABEL, expected_channel_name: OTHER_NAME }));
    await refused(check("slack_reactions_add", { channel: OTHER_CHANNEL, ts: OWN_TS, name: "eyes" }));
  });

  it("refuses the fixture named by #name or padded, so the guard never resolves a name differently from the plugin", async () => {
    await refused(check("slack_message_post", { channel: `#${FIXTURE_NAME}`, text: LABEL, expected_channel_name: FIXTURE_NAME }));
    await refused(check("slack_message_post", { channel: ` ${FIXTURE_CHANNEL}`, text: LABEL, expected_channel_name: FIXTURE_NAME }));
  });

  it("refuses a message that does not carry the label, or that could mention or notify anyone", async () => {
    const post = (text: string) => check("slack_message_post", { channel: FIXTURE_CHANNEL, text, expected_channel_name: FIXTURE_NAME });
    await refused(post("hello"));
    await refused(post(`${SUBJECT_PREFIX} no stamp`));
    for (const text of [`${LABEL} <@${OTHER_ID}>`, `${LABEL} <!channel>`, `${LABEL} <!here>`, `${LABEL} @here`, `${LABEL} <!subteam^S1>`]) {
      await refused(post(text));
    }
    await refused(check("slack_message_update", { channel: FIXTURE_CHANNEL, ts: OWN_TS, text: `${LABEL} <!everyone>`, expected_channel_name: FIXTURE_NAME }));
    await refused(check("slack_dm_send", { user: SELF, text: "unlabelled", expected_user_email: SELF }));
  });

  it("refuses an edit, a reaction or a reply on a message the run did not post", async () => {
    await refused(check("slack_message_update", { channel: FIXTURE_CHANNEL, ts: STRANGER_TS, text: LABEL, expected_channel_name: FIXTURE_NAME }));
    await refused(check("slack_reactions_add", { channel: FIXTURE_CHANNEL, ts: STRANGER_TS, name: "eyes" }));
    await refused(
      check("slack_message_post", { channel: FIXTURE_CHANNEL, text: LABEL, thread_ts: STRANGER_TS, expected_channel_name: FIXTURE_NAME })
    );
  });

  it("refuses a DM to anyone but the test user, by email or by id, and an expectation naming someone else", async () => {
    await refused(check("slack_dm_send", { user: OTHER_PERSON, text: LABEL, expected_user_email: OTHER_PERSON }));
    await refused(check("slack_dm_send", { user: SELF_ID, text: LABEL, expected_user_email: SELF }));
    await refused(check("slack_dm_send", { user: SELF, text: LABEL, expected_user_email: OTHER_PERSON }));
  });

  it("refuses every write when the run has no Slack scope, no fixture channel, no test user or no stamp", async () => {
    const post = { channel: FIXTURE_CHANNEL, text: LABEL, expected_channel_name: FIXTURE_NAME };
    await refused(check("slack_message_post", post, { slack: undefined }));
    await refused(check("slack_message_post", post, { slack: scope({ channel: null }) }));
    await refused(check("slack_dm_send", { user: SELF, text: LABEL, expected_user_email: SELF }, { slack: scope({ self: null }) }));
    await refused(check("slack_message_post", post, { runStamp: "" }));
  });

  it("refuses a slack_ tool it has no rule for, so a new write fails closed", async () => {
    await refused(check("slack_message_delete", { channel: FIXTURE_CHANNEL, ts: OWN_TS }));
  });
});

describe("what counts as posted by this run", () => {
  it("records the ts of a post the plugin answered in the fixture channel, and nothing else", () => {
    const posted = newSlackPosted();
    recordSlackPosted(posted, FIXTURE_CHANNEL, "slack-mcp__slack_message_post", JSON.stringify({ channel: { id: FIXTURE_CHANNEL }, ts: OWN_TS }));
    recordSlackPosted(posted, FIXTURE_CHANNEL, "slack-mcp__slack_message_post", JSON.stringify({ channel: { id: OTHER_CHANNEL }, ts: STRANGER_TS }));
    recordSlackPosted(posted, FIXTURE_CHANNEL, "slack-mcp__slack_channel_history", JSON.stringify({ channel: { id: FIXTURE_CHANNEL }, ts: "1" }));
    recordSlackPosted(posted, FIXTURE_CHANNEL, "slack-mcp__slack_message_post", "not json");
    recordSlackPosted(posted, null, "slack-mcp__slack_message_post", JSON.stringify({ channel: { id: FIXTURE_CHANNEL }, ts: "2" }));
    expect([...posted]).toEqual([OWN_TS]);
  });
});

/* ---- through the runner's dispatch, into the plugin's real handler ---- */

type SlackCall = { method: string; params: Record<string, unknown> };
type Handler = (client: unknown, name: string, args: Record<string, unknown>) => Promise<{ content: { type: string; text: string }[]; isError?: boolean }>;
let handleSlackWrite: Handler;

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
beforeAll(async () => {
  // A computed URL, as the Notion guard test imports its plugin, so the
  // gateway's typecheck does not follow into the plugin.
  const mod = await import(
    /* @vite-ignore */ pathToFileURL(path.join(REPO_ROOT, "plugins/slack-mcp/src/tools/slack-write.ts")).href
  );
  handleSlackWrite = mod.handleSlackWrite;
});

const CHANNELS: Record<string, string> = { [FIXTURE_CHANNEL]: FIXTURE_NAME, [OTHER_CHANNEL]: OTHER_NAME };
const PEOPLE: Record<string, string> = { [SELF]: SELF_ID, [OTHER_PERSON]: OTHER_ID };

/** Answers shaped like Slack's, enough for each handler to reach its send. */
function recordingSlack(calls: SlackCall[]) {
  return {
    async call(method: string, params: Record<string, unknown> = {}) {
      calls.push({ method, params });
      switch (method) {
        case "conversations.info":
          return { channel: { id: params.channel, name: CHANNELS[String(params.channel)] } };
        case "users.lookupByEmail": {
          const email = String(params.email).toLowerCase();
          return { user: { id: PEOPLE[email], profile: { email } } };
        }
        case "conversations.open":
          return { channel: { id: `D${String(params.users).slice(1)}` } };
        case "chat.postMessage":
        case "chat.update":
          return { ts: params.ts ?? OWN_TS };
        default:
          return {};
      }
    },
  };
}

describe("through the runner's dispatch, against the plugin's real handler", () => {
  const fixtures = parseFixtureMap(
    JSON.stringify({ accounts: { slack: SELF }, fixtures: { slackChannel: FIXTURE_CHANNEL } })
  );

  function harness() {
    const slackCalls: SlackCall[] = [];
    const callTool = vi.fn(async (name: string, args: Record<string, unknown>) =>
      handleSlackWrite(recordingSlack(slackCalls), name.slice(name.indexOf("__") + 2), args)
    );
    const parts = makeContextParts({
      client: { listTools: vi.fn(), callTool, close: vi.fn() },
      fixtures,
      called: [],
      runStamp: STAMP,
      slackPosted: newSlackPosted(),
    });
    return { parts, callTool, slackCalls };
  }

  it("send guard refuses a Slack write outside the fixture channel against the real handler", async () => {
    // The plugin alone would post this: its expectation names the channel
    // it resolves to. Shown on the bare handler first.
    const direct: SlackCall[] = [];
    await handleSlackWrite(recordingSlack(direct), "slack_message_post", {
      channel: OTHER_CHANNEL,
      text: LABEL,
      expected_channel_name: OTHER_NAME,
    });
    expect(direct.filter((c) => c.method === "chat.postMessage").map((c) => c.params.channel)).toEqual([OTHER_CHANNEL]);

    // Through the runner: refused, and no Slack method is called at all.
    const { parts, callTool, slackCalls } = harness();
    await expect(
      parts.call("slack-mcp__slack_message_post", { channel: OTHER_CHANNEL, text: LABEL, expected_channel_name: OTHER_NAME }, { as: "slack" })
    ).rejects.toThrow(/send refused/);
    await expect(
      parts.call("slack-mcp__slack_reactions_add", { channel: OTHER_CHANNEL, ts: OWN_TS, name: "eyes" }, { as: "slack" })
    ).rejects.toThrow(/send refused/);
    expect(callTool).not.toHaveBeenCalled();
    expect(slackCalls).toEqual([]);
  });

  it("posts to the fixture channel, then may edit and react to that post and nothing older", async () => {
    const { parts, slackCalls } = harness();
    // Not posted by this run yet: refused before Slack is asked anything.
    await expect(
      parts.call("slack-mcp__slack_reactions_add", { channel: FIXTURE_CHANNEL, ts: OWN_TS, name: "eyes" }, { as: "slack" })
    ).rejects.toThrow(/send refused/);
    expect(slackCalls).toEqual([]);

    await parts.call("slack-mcp__slack_message_post", { channel: FIXTURE_CHANNEL, text: LABEL, expected_channel_name: FIXTURE_NAME }, { as: "slack" });
    await parts.call(
      "slack-mcp__slack_message_update",
      { channel: FIXTURE_CHANNEL, ts: OWN_TS, text: `${LABEL} edited`, expected_channel_name: FIXTURE_NAME },
      { as: "slack" }
    );
    await parts.call("slack-mcp__slack_reactions_add", { channel: FIXTURE_CHANNEL, ts: OWN_TS, name: "eyes" }, { as: "slack" });
    const writes = slackCalls.filter((c) => ["chat.postMessage", "chat.update", "reactions.add"].includes(c.method));
    expect(writes.map((c) => [c.method, c.params.channel])).toEqual([
      ["chat.postMessage", FIXTURE_CHANNEL],
      ["chat.update", FIXTURE_CHANNEL],
      ["reactions.add", FIXTURE_CHANNEL],
    ]);
  });

  it("send guard allows a DM only to the test user's own DM", async () => {
    // The plugin alone would DM someone else: the expectation names them.
    const direct: SlackCall[] = [];
    await handleSlackWrite(recordingSlack(direct), "slack_dm_send", { user: OTHER_PERSON, text: LABEL, expected_user_email: OTHER_PERSON });
    expect(direct.filter((c) => c.method === "conversations.open").map((c) => c.params.users)).toEqual([OTHER_ID]);

    const { parts, slackCalls } = harness();
    await expect(
      parts.call("slack-mcp__slack_dm_send", { user: OTHER_PERSON, text: LABEL, expected_user_email: OTHER_PERSON }, { as: "slack" })
    ).rejects.toThrow(/send refused/);
    await expect(
      parts.call("slack-mcp__slack_dm_send", { user: OTHER_ID, text: LABEL, expected_user_email: SELF }, { as: "slack" })
    ).rejects.toThrow(/send refused/);
    expect(slackCalls).toEqual([]);

    await parts.call("slack-mcp__slack_dm_send", { user: SELF, text: LABEL, expected_user_email: SELF }, { as: "slack" });
    expect(slackCalls.filter((c) => c.method === "conversations.open").map((c) => c.params.users)).toEqual([SELF_ID]);
    expect(slackCalls.filter((c) => c.method === "chat.postMessage").map((c) => c.params.channel)).toEqual([`D${SELF_ID.slice(1)}`]);
  });
});
