"use client";

import type { ReactNode } from "react";
import { SetupInstructions } from "@/components/setup-instructions";
import { buttonVariants } from "@/components/ui/button";

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
  /** A write that stopped for approval in a conversation the user has come
   * back to. The decision cannot be given any more, so this replaces the
   * buttons rather than replaying them. */
  "approval-expired": { toolName: string };
};

/** Exported because the empty state renders the same control before any
 * message exists: an unconnected user must meet ONE connect affordance, not a
 * different one depending on whether the agent has spoken yet.
 *
 * NOTE FOR WHOEVER WIRES THE SERVER EMITTER: today this is the ONLY use, and
 * it is rendered directly rather than travelling through the data-part
 * pipeline, so the registry is real infrastructure with no producer yet. When
 * the agent starts emitting `data-connect` mid-conversation ("you asked for
 * Jira but only connected Google"), decide deliberately whether it replaces
 * this instance or coexists with it, and note that this one lists ALL services
 * unconditionally while a server-emitted one should name only what the request
 * actually needed. */
/** Only these can be a connect target. The hrefs come from our own SERVICES
 * list today, so this changes nothing now — but this component also renders
 * from a `data-connect` part, and a part is data rather than code. A
 * `javascript:` href in one would execute on click, and "the data is ours" is
 * a property of today's producers, not of the component. */
function safeConnectHref(href: string): string | null {
  return /^\/[^/]/.test(href) || /^https:\/\//.test(href) ? href : null;
}

export function ConnectPart({ services }: AgentDataParts["connect"]) {
  if (services.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <p className="text-xs text-foreground">
        Connect an account and I can work with your own files.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {services.map((service) => safeConnectHref(service.connectHref) && (
          // A PLAIN ANCHOR, NOT next/link. These are Express OAuth routes,
          // not Next pages: Link prefetches them with an `_rsc` param, the
          // route answers 302 to the provider, and the cross-origin prefetch
          // dies as a CORS failure. Harmless to the page, but it is a console
          // error and a wasted request on every render. Every other connect
          // button in the dashboard is already a plain anchor; this one was
          // the outlier.
          <a
            className={buttonVariants({ size: "sm" })}
            href={safeConnectHref(service.connectHref) as string}
            key={service.id}
          >
            Connect {service.name}
          </a>
        ))}
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

/** Every declared kind, rendered. Total by type: adding a key above without a
 * renderer here is a compile error. */
const AGENT_PART_RENDERERS: {
  [K in keyof AgentDataParts]: (data: AgentDataParts[K]) => ReactNode;
} = {
  connect: (data) => <ConnectPart {...data} />,
  "mcp-config": () => <McpConfigPart />,
  "account-state": (data) => <AccountStatePart {...data} />,
  "approval-expired": (data) => <ApprovalExpiredPart {...data} />,
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
