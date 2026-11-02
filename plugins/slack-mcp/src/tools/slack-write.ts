import { SlackApiError, displayName, resolveChannel, type SlackClient } from "../slack-client.js";
import { ADDITIVE, WRITE, type ToolDef } from "./annotations.js";
import { checkExpectedChannel, checkExpectedUser } from "./expected-target.js";
import { jsonResponse } from "./response.js";
import { channelArg, required, tsArg } from "./slack-read.js";

/* The four write tools (SCRUM-454, spec section 3). Each acts as the
 * connected user. Post, DM and update resolve their target, check it against
 * the required expected_* argument, and only then send; a mismatch sends
 * nothing. A write is never retried (slack-client.ts), and one that got no
 * answer says it may have landed. */

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === "string" && v !== "" ? v : undefined);

/** Slack's limit on a message's text. */
const MAX_TEXT = 40_000;

function messageText(args: Obj): string {
  const v = args.text;
  if (typeof v !== "string" || v.trim() === "") throw new Error("text is required: the message to send.");
  if (v.length > MAX_TEXT) throw new Error(`text is ${v.length} characters; Slack takes at most ${MAX_TEXT}.`);
  return v;
}

const textArg = (what: string) => ({
  type: "string",
  description: `The ${what}, in Slack's mrkdwn (for example *bold*, _italic_, <@U0123ABCD> to mention a person). Up to 40,000 characters.`,
});

const expectedChannelArg = {
  type: "string",
  description:
    "The name of the channel this message is meant for, as words, for example #general. The call is refused and nothing is sent unless the channel argument resolves to a channel of this name (compared without # and without case).",
};

export const slackWriteTools: ToolDef[] = [
  {
    name: "slack_reactions_add",
    description:
      "Adds an emoji reaction, as the connected user, to one Slack message. Takes the channel, the message's ts and the emoji name, and returns {channel {id, name}, ts, name, added}, with added false and already_reacted true when the user had already reacted with that emoji.",
    inputSchema: {
      type: "object",
      properties: {
        channel: channelArg,
        ts: tsArg("message"),
        name: {
          type: "string",
          description: "The emoji's name, with or without colons, for example thumbsup or :eyes:. A custom emoji is named as the workspace names it.",
        },
      },
      required: ["channel", "ts", "name"],
    },
    annotations: ADDITIVE("Add Slack reaction"),
  },
  {
    name: "slack_message_update",
    description:
      "Replaces the text of one Slack message the connected user posted. Takes the channel, the message's ts, the new text and expected_channel_name; the call is refused and nothing is changed unless the channel resolves to that name. Returns {channel {id, name}, ts}.",
    inputSchema: {
      type: "object",
      properties: {
        channel: channelArg,
        ts: tsArg("message"),
        text: textArg("new text of the message, which replaces the old text whole"),
        expected_channel_name: expectedChannelArg,
      },
      required: ["channel", "ts", "text", "expected_channel_name"],
    },
    annotations: WRITE("Update Slack message"),
  },
  {
    name: "slack_message_post",
    description:
      "Posts a message as the connected user to a Slack channel, or as a reply in a thread when thread_ts is given. Takes the channel, the text, an optional thread_ts and expected_channel_name; the call is refused and nothing is sent unless the channel resolves to that name. Returns {channel {id, name}, ts, thread_ts}.",
    inputSchema: {
      type: "object",
      properties: {
        channel: channelArg,
        text: textArg("message"),
        thread_ts: {
          type: "string",
          description: "The ts of a thread's parent message; the post becomes a reply in that thread. Absent posts to the channel itself.",
        },
        expected_channel_name: expectedChannelArg,
      },
      required: ["channel", "text", "expected_channel_name"],
    },
    annotations: WRITE("Post Slack message"),
  },
  {
    name: "slack_dm_send",
    description:
      "Sends a direct message as the connected user to one person in the Slack workspace. Takes the person as a user id or an email address, the text and expected_user_email; the call is refused and no conversation is opened unless the person's Slack email equals expected_user_email. Returns {user {id, name, email}, channel, ts}.",
    inputSchema: {
      type: "object",
      properties: {
        user: {
          type: "string",
          description: "The person: a Slack user id (for example U0123ABCD) or the email address on their Slack profile.",
        },
        text: textArg("message"),
        expected_user_email: {
          type: "string",
          description:
            "The email address of the person this message is meant for. The call is refused and nothing is sent unless the person resolves to a Slack profile with this email (compared without case).",
        },
      },
      required: ["user", "text", "expected_user_email"],
    },
    annotations: WRITE("Send Slack direct message"),
  },
];

export async function handleSlackWrite(client: SlackClient, name: string, args: Obj) {
  switch (name) {
    case "slack_reactions_add": {
      const ts = required(args, "ts", "the message's ts");
      const emoji = required(args, "name", "the emoji's name").replace(/^:+|:+$/g, "");
      if (emoji === "") throw new Error("name is required: the emoji's name.");
      const channel = await resolveChannel(client, required(args, "channel", "a channel id or #name"));
      try {
        await client.call("reactions.add", { channel: channel.id, timestamp: ts, name: emoji });
      } catch (err) {
        if (err instanceof SlackApiError && err.error === "already_reacted") {
          return jsonResponse({ channel, ts, name: emoji, added: false, already_reacted: true });
        }
        throw err;
      }
      return jsonResponse({ channel, ts, name: emoji, added: true });
    }

    case "slack_message_update": {
      const ts = required(args, "ts", "the message's ts");
      const text = messageText(args);
      const expected = required(args, "expected_channel_name", "the name of the channel the message is in, in words");
      const channel = await resolveChannel(client, required(args, "channel", "a channel id or #name"));
      checkExpectedChannel(channel, expected);
      const body = await client.call<Obj>("chat.update", { channel: channel.id, ts, text });
      return jsonResponse({ channel, ts: str(body.ts) ?? ts });
    }

    case "slack_message_post": {
      const text = messageText(args);
      const expected = required(args, "expected_channel_name", "the name of the channel the message is for, in words");
      const threadTs = typeof args.thread_ts === "string" && args.thread_ts.trim() !== "" ? args.thread_ts.trim() : undefined;
      const channel = await resolveChannel(client, required(args, "channel", "a channel id or #name"));
      checkExpectedChannel(channel, expected);
      const body = await client.call<Obj>("chat.postMessage", { channel: channel.id, text, thread_ts: threadTs });
      return jsonResponse({ channel, ts: body.ts, ...(threadTs ? { thread_ts: threadTs } : {}) });
    }

    case "slack_dm_send": {
      const ref = required(args, "user", "a Slack user id or email address");
      const text = messageText(args);
      const expected = required(args, "expected_user_email", "the email address of the person the message is for");
      const looked = ref.includes("@")
        ? await client.call<Obj>("users.lookupByEmail", { email: ref })
        : await client.call<Obj>("users.info", { user: ref });
      const user = isObj(looked.user) ? looked.user : {};
      const id = str(user.id);
      if (!id) throw new Error(`Slack returned no user for ${ref}; nothing was sent.`);
      const email = isObj(user.profile) ? str(user.profile.email) ?? null : null;
      checkExpectedUser(email, expected, id);
      const opened = await client.call<Obj>("conversations.open", { users: id });
      const dm = isObj(opened.channel) ? str(opened.channel.id) : undefined;
      if (!dm) throw new Error(`Slack opened no direct message with ${id}; nothing was sent.`);
      const body = await client.call<Obj>("chat.postMessage", { channel: dm, text });
      return jsonResponse({
        user: { id, name: displayName(user as { id: string }), email },
        channel: dm,
        ts: body.ts,
      });
    }

    default:
      throw new Error(`Unknown Slack write tool: ${name}`);
  }
}
