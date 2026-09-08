import type { RunStatus } from "@datatorag-mcp/db";
import { serviceName } from "../skills-catalogue";

/**
 * The one email a scheduled run may send (SCRUM-225). Outbound copy: casual
 * structure, standard capitalisation, lowercase subject, no em-dashes, one
 * obvious next step per outcome. The thread is the full record; this is the
 * pointer to it, and for the three bad outcomes, the one thing to do next.
 */

export type RunEmailInput = {
  status: Exclude<RunStatus, "running">;
  skillTitle: string;
  threadUrl: string;
  connectionsUrl: string;
  billingUrl: string;
  skillsUrl: string;
  /** The service to reconnect, for `reconnect`. */
  service: string | null;
  /** The capped failure reason, for `failed`. */
  error: string | null;
  /** The turn's final text, for `succeeded`. Excerpted, never the whole brief. */
  resultText: string;
};

export type RunEmail = {
  subject: string;
  text: string;
  html: string;
};

export const RUN_EMAIL_SENDER_NAME = "DataToRAG";
const EXCERPT_MAX = 1500;

function excerpt(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > EXCERPT_MAX ? `${trimmed.slice(0, EXCERPT_MAX).trimEnd()}...` : trimmed;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Short title for the subject line: the skill's title is a full sentence
 * with the product name in it, which is too long for a subject. */
function shortTitle(title: string): string {
  return title.replace(/\s+with Claude\.?$/i, "").trim();
}

export function runEmail(input: RunEmailInput): RunEmail {
  const ours = new Set([input.threadUrl, input.connectionsUrl, input.billingUrl, input.skillsUrl]);
  const title = shortTitle(input.skillTitle);
  const lines: string[] = [];
  let subject: string;

  switch (input.status) {
    case "succeeded":
      subject = `your scheduled skill ran: ${title.toLowerCase()}`;
      lines.push(`Your scheduled skill "${title}" just ran. Here is how it ended:`);
      lines.push("");
      lines.push(excerpt(input.resultText) || "(the run finished without a summary)");
      lines.push("");
      lines.push(`The full thread, with every step it took: ${input.threadUrl}`);
      break;
    case "refused":
      subject = `your schedule is paused: ${title.toLowerCase()}`;
      lines.push(
        `Your scheduled skill "${title}" did not run today because your run allowance for this period is used up, so the schedule is paused.`
      );
      lines.push("");
      lines.push(`The allowance resets with your billing period. To raise it, or see where you are: ${input.billingUrl}`);
      lines.push(`When you are ready, resume the schedule here: ${input.skillsUrl}`);
      break;
    case "reconnect":
      subject = `your schedule needs a reconnect: ${title.toLowerCase()}`;
      lines.push(
        `Your scheduled skill "${title}" stopped because ${
          input.service && input.service !== "unknown"
            ? serviceName(input.service)
            : "one of your connected services"
        } is no longer connected, so the schedule is paused until you reconnect it.`
      );
      lines.push("");
      lines.push(`Reconnect here: ${input.connectionsUrl}`);
      lines.push(`Then resume the schedule here: ${input.skillsUrl}`);
      lines.push(`What it managed before stopping is in the thread: ${input.threadUrl}`);
      break;
    case "failed":
    default:
      subject = `your scheduled skill did not finish: ${title.toLowerCase()}`;
      lines.push(`Your scheduled skill "${title}" did not finish this time.`);
      if (input.error) {
        lines.push("");
        lines.push(`The reason it reported: ${excerpt(input.error)}`);
      }
      lines.push("");
      lines.push(`What it did before stopping is in the thread: ${input.threadUrl}`);
      lines.push(
        "It will try again at the next scheduled time. After three failures in a row the schedule pauses itself, and you can pause or resume it any time from your Skills page."
      );
      break;
  }

  lines.push("");
  lines.push("Cheers,");
  lines.push("DataToRAG");
  const text = lines.join("\n");
  const html = `<div style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#1c1917">${lines
    .map((l) => (l === "" ? "<br>" : `<p style="margin:0 0 4px">${linkify(escapeHtml(l), ours)}</p>`))
    .join("")}</div>`;
  return { subject, text, html };
}

/** Turns OUR links into anchors and nothing else. The result excerpt is
 * model output, and a tool result can carry a URL the model repeats; that
 * stays plain text, never a clickable link in a message we sent. Runs on
 * escaped text, and our own URLs contain nothing that escaping changes. */
function linkify(escaped: string, ours: ReadonlySet<string>): string {
  return escaped.replace(/https?:\/\/[^\s<]+/g, (url) => (ours.has(url) ? `<a href="${url}">${url}</a>` : url));
}
