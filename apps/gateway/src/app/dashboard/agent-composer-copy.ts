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

/** Nothing connected yet.
 *
 * SERVICE-NEUTRAL ON PURPOSE. An earlier version named Google specifically,
 * which read as a precondition rather than an example: the empty state
 * directly above this offers Google Workspace AND Atlassian as peer buttons,
 * so singling one out narrows what the product does for an Atlassian-only
 * user. Staying neutral also sidesteps a naming inconsistency, since the
 * connector is called "Google Workspace" everywhere else in the product and a
 * placeholder saying "Google account" disagreed with the button beside it.
 *
 * Keep it neutral as connectors are added. The connect controls enumerate the
 * services; this line only has to ask for one. */
export const COMPOSER_PLACEHOLDER_UNCONNECTED =
  "Connect an account to get started.";

/** The ordinary state. */
export const COMPOSER_PLACEHOLDER_READY = "Ask something…";

/** A gated write is waiting on a decision, and the composer is locked until it
 * gets one. The placeholder says why, so the lock does not read as a fault. */
export const COMPOSER_PLACEHOLDER_AWAITING_CONFIRM =
  "Approve or deny the action above to continue";

/** Every placeholder, for the rules that apply to all of them. */
export const ALL_COMPOSER_PLACEHOLDERS = [
  COMPOSER_PLACEHOLDER_UNCONNECTED,
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
