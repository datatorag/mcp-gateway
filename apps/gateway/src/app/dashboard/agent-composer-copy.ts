/**
 * The composer's placeholder, in each state the composer can be in.
 *
 * In its own module for the same reason `agent-cap-copy.ts` is: so the
 * mechanical rules can be ASSERTED rather than remembered. That module already
 * pins "playground" out of user-facing text, and this copy broke the rule
 * anyway, because the test could only see strings the module exported. The
 * placeholder sat inline in `playground.tsx` saying "Connect an account to try
 * the playground" on the surface that is becoming the front door. A rule
 * enforced in one file and violated in the file next to it is the failure this
 * module exists to close.
 */

/** The ordinary state, connected or not.
 *
 * There is deliberately NO unconnected variant (SCRUM-98). The composer is
 * enabled with nothing connected: the user can ask, the agent notices the
 * missing connection itself and offers the connect control in its reply, and
 * that in-conversation ask is the whole design of this surface. A previous
 * placeholder said "Connect an account to get started", which described a
 * lock the control does not have, contradicted the empty state one line above
 * it ("You can ask me anything in the meantime"), and kept saying "get
 * started" under a thread the user had already started. An earlier pass had
 * made that string service-neutral so it would stop reading as a
 * precondition; neutrality was the wrong axis, because the problem was that
 * it described a gate at all. A placeholder may only describe a restriction
 * the component actually enforces, so the connection-dependent placeholder is
 * gone rather than reworded. */
export const COMPOSER_PLACEHOLDER_READY = "Ask something…";

/** A gated write is waiting on a decision, and the composer is locked until it
 * gets one. The placeholder says why, so the lock does not read as a fault. */
export const COMPOSER_PLACEHOLDER_AWAITING_CONFIRM =
  "Approve or deny the action above to continue";

/** Every placeholder, for the rules that apply to all of them. */
export const ALL_COMPOSER_PLACEHOLDERS = [
  COMPOSER_PLACEHOLDER_READY,
  COMPOSER_PLACEHOLDER_AWAITING_CONFIRM,
];

/* -------------------------------------------------------------------------- */
/* The embedded panel's own labels                                             */
/* -------------------------------------------------------------------------- */

/** The dashboard widget's heading and the labels around it.
 *
 * Here for the same reason the placeholders are: these were the LAST visible
 * uses of the retired term, and they survived three separate passes at
 * retiring it precisely because they sat inline in components where no
 * export-list guard could see them. The rule was pinned on the cap panel, then
 * the composer, then the marketing pages, and this widget kept saying it
 * anyway.
 *
 * The module they live in is named for the composer, which is a slightly loose
 * fit. Being visible to the guard beats being filed tidily. */
export const PANEL_HEADING = "Agent";
export const PANEL_STANDFIRST = "Chat with your connected accounts, right here.";

/** Copy on the dashboard's quick-start prompt cards, which point AT the panel
 * and therefore have to call it the same thing. */
export const PROMPT_CARDS_STANDFIRST =
  "Run one below in the Agent, or copy it into your own AI client.";
export const PROMPT_CARD_RUN_LABEL = "Run in the Agent";

/** The connected-service card's link into that service's tool browser.
 *
 * NOT "Agent", even though this is a term-retirement rename. The control goes
 * to `/dashboard/connections/[service]`, whose own heading is "Tools": you
 * pick a tool, fill in its inputs and run it. Relabelling it "Agent" would
 * swap one wrong word for another and send people somewhere other than where
 * the label promised. Labels say what the control does. */
export const SERVICE_CARD_TOOLS_LABEL = "Browse tools";

/** Everything above that a user reads, for the rules that apply to all of it. */
export const ALL_PANEL_COPY = [
  PANEL_HEADING,
  PANEL_STANDFIRST,
  PROMPT_CARDS_STANDFIRST,
  PROMPT_CARD_RUN_LABEL,
  SERVICE_CARD_TOOLS_LABEL,
];
