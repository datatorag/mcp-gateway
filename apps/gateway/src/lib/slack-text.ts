/** Text a stranger supplied, made inert in a Slack message: `<` and `>` are
 * escaped so it cannot mention a channel or a person or disguise a link. */
export function slackEscape(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The same, on one line: interior line breaks collapse to a space, so a
 * value cannot start a line of its own and pass for another field. */
export function slackField(text: string): string {
  return slackEscape(text.replace(/\s*[\r\n\u0085\u2028\u2029]+\s*/g, " "));
}
