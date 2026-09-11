"use client";

import { createContext, useContext, type ReactNode } from "react";
import posthog from "posthog-js";
import { SetupInstructions } from "@/components/setup-instructions";
import { buttonVariants } from "@/components/ui/button";
import { EVENTS } from "@/lib/analytics";
import { formatCost, formatTokens } from "@/lib/usage-format";
import { getService } from "./connections/services";
import { GrantPanel } from "./connections/grant-panel";
import { grantState } from "./connections/grant-state";
import type { ScopeStatus } from "./connections/types";

/** Where the connect flow should RETURN to — the thread the user is looking
 * at (SCRUM-78). A context rather than a prop because ConnectPart renders
 * deep inside the memoized message list, via a renderer map that takes only
 * the part's own data; threading a return path through every row for the one
 * part that needs it would put thread identity into components that have no
 * business knowing it. Null until the first turn's response names the thread
 * (or outside any provider), in which case the connect returns to the Agent
 * page's default view — which still lands IN the agent, just without a
 * conversation to resume. */
export const ConnectReturnContext = createContext<{ nextPath: string | null }>({
  nextPath: null,
});

/** What each service's DEFAULT account actually granted, keyed by service id
 * (SCRUM-106).
 *
 * A CONTEXT, AND NOT PART OF THE `data-connect` PAYLOAD, for exactly the
 * reason the return path above is not: a data part PERSISTS in the thread and
 * replays on every reopen. Grant state baked into a stored part would keep
 * telling a user that Calendar is missing long after they reconnected and
 * granted it, and the older the thread the more confidently wrong it would be.
 * Resolved at render time, from the same `/api/connections` response the
 * connections page reads, so the two surfaces cannot disagree.
 *
 * Empty by default, which reads as "we do not know" and renders the plain
 * connect card, i.e. exactly today's behaviour. */
export const ConnectGrantContext = createContext<{
  scopeStatusByService: Record<string, ScopeStatus | undefined>;
}>({ scopeStatusByService: {} });

/** What the stop card can do (SCRUM-234). `continueRun` sends the fixed
 * continuation for the skill in the same thread; absent (the default, and
 * the docs/landing renderings) the card shows the notice with no button,
 * because a button that cannot act is worse than none. */
export const RunControlContext = createContext<{
  continueRun: ((skill: string) => void) | null;
  busy: boolean;
}>({ continueRun: null, busy: false });

/**
 * Things the agent can put in the thread that are not text and not a tool call.
 *
 * WHY A DATA PART AND NOT A SYNTHETIC ROW. The deciding criterion was taking a
 * third and a fourth kind without rework, and three are already known: the
 * connect control, the config block, and account-state readouts. A data part is
 * POSITIONAL by nature. It arrives in the stream where the agent put it,
 * between the turns it belongs between. A synthetic row has to be placed by a
 * rule held outside the message list, and every new kind makes that rule more
 * elaborate until the rule IS the feature. A data part also survives
 * persistence and replay for free, because it lives in the message the memory
 * store already round-trips; a synthetic row is recomputed from current state
 * on every render, so a config block offered three turns ago either reappears
 * at the bottom or vanishes.
 *
 * ADDING A FOURTH IS TWO ADDITIVE EDITS: a key here, and an entry in
 * AGENT_PART_RENDERERS. Nothing existing changes, and MessageRow never learns
 * about it. The renderer map is typed as a total Record over this map's keys,
 * so a kind declared without a renderer fails `tsc` rather than rendering
 * nothing at runtime, which is the failure mode that would be invisible.
 */
export type AgentDataParts = {
  /** Offered when the agent needs access it does not have. Inline, in the
   * thread, because the whole point is not sending the user elsewhere. */
  connect: { services: Array<{ id: string; name: string; connectHref: string }> };
  /** The MCP config, for someone who would rather use their own client. */
  "mcp-config": Record<string, never>;
  /** Where the user stands. Turns the allowance from a wall into a meter. */
  "account-state": {
    runsRemaining: number | null;
    runsCap: number | null;
    connectedAccounts: string[];
  };
  /** A cap stopped the run (SCRUM-234): which one, how far it got, and the
   * skill to continue, if it was a skill run. Put in the thread by the chat
   * route before the stream closes. The same card carries what the thread
   * reader knows about a run whose viewer left (SCRUM-254): `running` while
   * it is still going, `error` when it failed after the viewer left. */
  "run-stopped": {
    limit: "steps" | "size" | "running" | "error";
    steps: number;
    cap: number | null;
    skill: string | null;
  };
  /** A write that stopped for approval in a conversation the user has come
   * back to. The decision cannot be given any more, so this replaces the
   * buttons rather than replaying them. */
  "approval-expired": { toolName: string };
  /** What the run cost (SCRUM-257): steps, the ceiling's weighted tokens and
   * the priced cost, null when the model had no price row. Put in the
   * thread by the chat route at the finish. */
  "run-summary": {
    steps: number;
    weightedTokens: number;
    costUsd: number | null;
    model: string;
  };
};

/** Exported because the empty state renders the same control before any
 * message exists: an unconnected user must meet ONE connect affordance, not a
 * different one depending on whether the agent has spoken yet.
 *
 * TWO PRODUCERS NOW, DELIBERATELY COEXISTING (SCRUM-78). The empty state
 * renders this directly and lists ALL services, because before a request
 * exists nothing says which one is needed. Mid-conversation, the agent's
 * request_connection tool emits a `data-connect` part naming ONLY the service
 * the request actually needed. Same component, so the two affordances cannot
 * drift apart. */
/** Only these can be a connect target. The hrefs come from our own SERVICES
 * list today, so this changes nothing now — but this component also renders
 * from a `data-connect` part, and a part is data rather than code. A
 * `javascript:` href in one would execute on click, and "the data is ours" is
 * a property of today's producers, not of the component. */
function safeConnectHref(href: string): string | null {
  return /^\/[^/]/.test(href) || /^https:\/\//.test(href) ? href : null;
}

export function ConnectPart({
  services,
  source = "thread",
}: AgentDataParts["connect"] & {
  /** Which affordance this render is (SCRUM-112): the card the agent placed
   * mid-conversation, or the standing empty-state control. A render-site
   * fact, so it is a prop and NOT part of the stored `data-connect` payload —
   * the part must stay exactly what the server emitted. */
  source?: "thread" | "empty_state";
}) {
  const { nextPath } = useContext(ConnectReturnContext);
  const { scopeStatusByService } = useContext(ConnectGrantContext);
  if (services.length === 0) return null;

  /** SCRUM-106. `request_connection` emits this same part for a
   * CONNECTED-BUT-SHORT account as for one that was never connected, so the
   * card used to say "Connect an account and I can work with your own files"
   * to somebody who had already connected. What was actually missing reached
   * the user only through the model's prose, which is neither guaranteed nor
   * scannable, on the surface where the failure is happening.
   *
   * One service is the interesting case here: the agent asks about the
   * service the user's request needed, so a re-consent card names one thing. */
  const shortService =
    services.length === 1
      ? (() => {
          const id = services[0].id;
          const status = scopeStatusByService[id];
          const state = grantState(status, !!status);
          return state === "partial" || state === "none"
            ? { id, status }
            : null;
        })()
      : null;

  // The return path is composed HERE, at render time, not stored in the part:
  // the part persists in the thread, and a baked-in destination would go stale
  // the moment the same conversation is reopened under a different id (it is
  // not) or the control is rendered outside a thread (the empty state). The
  // `next` value is validated server-side either way (resolveNextPath), so
  // this composition is a convenience, not a trust boundary.
  const withReturn = (href: string): string =>
    nextPath ? `${href}?next=${encodeURIComponent(nextPath)}` : href;

  // A connected-but-short account gets the grant panel INSTEAD of the connect
  // control: it names what is missing, carries each service's mark, and its
  // own single anchor is the same one-click re-consent the connect button was.
  // Offering both would put two controls pointing at the same URL under two
  // different labels, one of which ("Connect") is untrue.
  if (shortService) {
    return (
      <div className="rounded-lg border border-border bg-secondary/40 p-3">
        <GrantPanel
          scopeStatus={shortService.status}
          // Through the same guard the connect buttons use: the href comes off
          // a stored part, and "the data is ours" is a property of today's
          // producers, not of this component.
          connectUrl={safeConnectHref(services[0].connectHref)}
          service={shortService.id}
          density="compact"
          source={source}
          nextPath={nextPath}
          // No rawScopes: compact renders no disclosure, and scope strings
          // have no business travelling to the agent surface at all.
        />
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <p className="text-xs text-foreground">
        Connect an account and I can work with your own files.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {services.map((service) => {
          // The same official marks the connector cards carry (SCRUM-97):
          // resolved HERE by service id because the data-connect part
          // arrives over the wire with id/name/href only - a stored part
          // cannot carry a React node, and duplicating the artwork would
          // let the two surfaces drift. Full-colour marks sit on a WHITE
          // TILE because these buttons are bg-primary in both themes and
          // the vendors' guidelines want the marks on a plain ground; the
          // tile is what makes one asset correct in light and dark alike.
          // Mark PLUS label, never mark alone - the label text is
          // untouched. An id the registry does not know renders the label
          // without a mark rather than a broken image.
          // Validated once: an id with no safe connect href renders nothing
          // (the map already drops filtered items), and the single local
          // removes the second regex pass and the non-null cast below.
          const href = safeConnectHref(service.connectHref);
          if (!href) return null;
          const mark = getService(service.id)?.icon;
          return (
          // A PLAIN ANCHOR, NOT next/link. These are Express OAuth routes,
          // not Next pages: Link prefetches them with an `_rsc` param, the
          // route answers 302 to the provider, and the cross-origin prefetch
          // dies as a CORS failure. Harmless to the page, but it is a console
          // error and a wasted request on every render. Every other connect
          // button in the dashboard is already a plain anchor; this one was
          // the outlier.
          <a
            className={buttonVariants({ size: "sm" })}
            href={withReturn(href)}
            key={service.id}
            // SCRUM-112: the click is a client fact, captured as one. The
            // capture does not gate navigation (no preventDefault): losing an
            // event to an ad-blocker is acceptable, delaying an OAuth
            // redirect on telemetry is not. Behaviour only — the service id
            // and the affordance, never content.
            onClick={() =>
              posthog.capture(EVENTS.CONNECT_CARD_CLICKED, {
                service: service.id,
                source,
              })
            }
          >
            {mark && (
              <span
                aria-hidden
                // The [&_svg]:size-4 is the tile constraining its OWN
                // content (SCRUM-118, carried from the SCRUM-97 gate): the
                // registry icons ship with h-8 w-8 classes and previously
                // rendered at 16px only because the button's svg-sizing rule
                // happened to reach them. A mark added to the registry
                // without that shape would have clipped here silently.
                className="mr-2 flex size-5 shrink-0 items-center justify-center rounded-sm bg-white [&_svg]:size-4"
              >
                {mark}
              </span>
            )}
            Connect {service.name}
          </a>
          );
        })}
      </div>
    </div>
  );
}

function McpConfigPart() {
  // `surface="agent"` is what separates a config the agent offered in
  // conversation from one found on a settings page. They are different user
  // states and the copy event has to be able to tell them apart.
  return <SetupInstructions sourcePrefix="wizard" surface="agent" />;
}

function AccountStatePart({
  runsRemaining,
  runsCap,
  connectedAccounts,
}: AgentDataParts["account-state"]) {
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs">
      {runsRemaining !== null && runsCap !== null && (
        <p className="text-foreground">
          {runsRemaining} of your {runsCap} runs left this period.
        </p>
      )}
      {connectedAccounts.length > 0 && (
        <p className="mt-1 text-muted-foreground">
          Connected: {connectedAccounts.join(", ")}
        </p>
      )}
    </div>
  );
}

/** A write that was waiting on a decision when the conversation ended.
 *
 * INERT ON PURPOSE, AND HONEST ABOUT WHY. The decision cannot be given now:
 * the suspended run is consumed on first use and approval ids deliberately do
 * not survive a restart. Replaying Approve and Deny would put two controls in
 * front of the user that answer 403, and dead controls are what got this
 * surface rolled back before. So it says what happened and offers nothing to
 * press. Nothing ran, which is what "expired" has to mean here. */
function ApprovalExpiredPart({ toolName }: AgentDataParts["approval-expired"]) {
  const short = toolName.split("__").pop() || toolName;
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3 text-xs">
      <p className="text-muted-foreground">
        This action needed your approval and the conversation ended before it
        was given, so it never ran.{" "}
        {short ? (
          <>
            Ask again to run <span className="font-mono">{short}</span>.
          </>
        ) : (
          "Ask again to run it."
        )}
      </p>
    </div>
  );
}

function RunStoppedPart({ limit, steps, cap, skill }: AgentDataParts["run-stopped"]) {
  const { continueRun, busy } = useContext(RunControlContext);
  const stepsText = `${steps} ${steps === 1 ? "step" : "steps"}`;
  // A run still going has nothing to continue from and nothing saved yet to
  // point at: it says so and asks for a reload, which is when the thread
  // reader can say more (SCRUM-254).
  if (limit === "running") {
    return (
      <div
        className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-foreground"
        data-testid="run-stopped"
      >
        <p>
          This run is still going after {stepsText}. Reload this conversation in a minute to see
          where it got to.
        </p>
      </div>
    );
  }
  const reached = limit === "size" || (cap !== null && steps >= cap);
  const what =
    limit === "size"
      ? `This run reached its size limit after ${stepsText}.`
      : limit === "error"
        ? `This run stopped with an error after ${stepsText}.`
        : reached
          ? `This run reached its step limit (${cap} steps).`
          : `This run stopped after ${stepsText}, before it finished.`;
  return (
    <div
      className="rounded-xl border border-border bg-muted/40 p-3 text-xs text-foreground"
      data-testid="run-stopped"
    >
      <p>{what} Everything it already finished is saved.</p>
      {skill && continueRun ? (
        <button
          type="button"
          className="mt-2 inline-flex items-center rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:bg-muted disabled:opacity-50"
          disabled={busy}
          onClick={() => continueRun(skill)}
        >
          Continue from where it stopped
        </button>
      ) : (
        <p className="mt-1 text-muted-foreground">Send a new message to continue.</p>
      )}
    </div>
  );
}

/** One quiet line under a finished run: the size of what just happened, in
 * the same words the usage page uses. No cost is said when none is known;
 * a run must never read as free because its model had no price. */
function RunSummaryPart({ steps, weightedTokens, costUsd }: AgentDataParts["run-summary"]) {
  const cost = formatCost(costUsd);
  return (
    <p className="text-xs text-muted-foreground" data-testid="run-summary">
      {steps} {steps === 1 ? "step" : "steps"}, {formatTokens(weightedTokens)}
      {cost ? `, ${cost}` : ""}
    </p>
  );
}

/** Every declared kind, rendered. Total by type: adding a key above without a
 * renderer here is a compile error. */
const AGENT_PART_RENDERERS: {
  [K in keyof AgentDataParts]: (data: AgentDataParts[K]) => ReactNode;
} = {
  connect: (data) => <ConnectPart {...data} source="thread" />,
  "mcp-config": () => <McpConfigPart />,
  "account-state": (data) => <AccountStatePart {...data} />,
  "approval-expired": (data) => <ApprovalExpiredPart {...data} />,
  "run-stopped": (data) => <RunStoppedPart {...data} />,
  "run-summary": (data) => <RunSummaryPart {...data} />,
};

/**
 * Render one data part, or `null` if it is not one of ours.
 *
 * The lookup is what keeps MessageRow out of this: it asks once, and never
 * grows a branch per kind. An unrecognised `data-*` renders nothing rather
 * than throwing, because a part from a newer server reaching an older client
 * is a normal thing during a deploy and is not worth breaking a thread over.
 */
export function renderAgentPart(type: string, data: unknown): ReactNode {
  if (!type.startsWith("data-")) return null;
  const kind = type.slice("data-".length);
  // hasOwn, not a plain lookup: `data-constructor` and `data-toString` would
  // otherwise resolve to inherited Object.prototype members and get called as
  // renderers. Nothing worse than a throw in the sender's own session today,
  // but it is a free guard on a map keyed by a string off the wire.
  if (!Object.hasOwn(AGENT_PART_RENDERERS, kind)) return null;
  const render = AGENT_PART_RENDERERS[kind as keyof AgentDataParts] as (
    data: unknown
  ) => ReactNode;
  return render(data);
}
