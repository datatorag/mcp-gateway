import { channelNameKey } from "../slack-client.js";

/* The expected-target guard (SCRUM-454, spec section 3). It follows
 * gmail_reply's expected_to, except that the argument is required: a post
 * notifies people the moment it lands, and deleting it does not undo the
 * notification. A person approving a call that shows C04... cannot tell a
 * wrong channel from a right one; a name in words can be checked.
 *
 * Each check runs after the target is resolved and before anything is sent,
 * and throws a refusal naming what the target resolved to. A thrown plain
 * Error reads as the plugin refusing the request (error-meta.ts). */

/** Refuses unless the resolved channel's name equals `expected`, compared
 * without a leading `#` and without case. */
export function checkExpectedChannel(resolved: { id?: string; name: string }, expected: string): void {
  const want = channelNameKey(expected ?? "");
  const where = `#${resolved.name}${resolved.id ? ` (${resolved.id})` : ""}`;
  if (want === "") {
    throw new Error(`Refused, nothing was sent: expected_channel_name is empty. The channel resolved to ${where}.`);
  }
  if (channelNameKey(resolved.name) !== want) {
    throw new Error(
      `Refused, nothing was sent: the channel resolved to ${where}, and expected_channel_name was "${expected.trim()}".`
    );
  }
}

/** Refuses unless the resolved person's email equals `expected`, compared
 * without case or surrounding space. A person whose email Slack does not
 * give cannot be checked, so is refused. `who` names the person in the
 * refusal, for example their user id. */
export function checkExpectedUser(email: string | null, expected: string, who?: string): void {
  const want = (expected ?? "").trim().toLowerCase();
  const person = who ? `${who}` : "the person";
  if (want === "") {
    throw new Error(`Refused, nothing was sent: expected_user_email is empty. The user resolved to ${person}${email ? ` (${email})` : ""}.`);
  }
  if (email === null || email.trim() === "") {
    throw new Error(
      `Refused, nothing was sent: Slack did not give an email for ${person}, so it cannot be checked against expected_user_email "${expected.trim()}".`
    );
  }
  if (email.trim().toLowerCase() !== want) {
    throw new Error(
      `Refused, nothing was sent: the user resolved to ${person} (${email}), and expected_user_email was "${expected.trim()}".`
    );
  }
}
