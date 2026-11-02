import { describe, expect, it } from "vitest";
import { connectorsFor, servicesFor } from "./skill-links";

/* SCRUM-454: a skill naming Slack tools needs the Slack connector, mapped by
 * the tool prefix like every other connector. */
describe("connectorsFor and servicesFor", () => {
  it("slack_ tools map to Slack", () => {
    expect(connectorsFor(["slack_messages_search", "gmail_read"])).toEqual(["Slack", "Google Workspace"]);
    expect(servicesFor({ tools: ["slack_message_post", "slack_channels_list"] })).toEqual(["slack"]);
  });

  it("a word that only starts like slack is not Slack", () => {
    expect(connectorsFor(["slackbot_ping"])).toEqual([]);
  });
});
