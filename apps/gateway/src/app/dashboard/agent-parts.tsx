"use client";

import type { ReactNode } from "react";
import Link from "next/link";
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
};

/** The `data-` prefixed part type for a kind, which is what arrives on the
 * wire. Stated once so no call site hand-writes the prefix. */
export type AgentPartType = `data-${keyof AgentDataParts & string}`;

function ConnectPart({ services }: AgentDataParts["connect"]) {
  if (services.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-secondary/40 p-3">
      <p className="text-xs text-foreground">
        Connect an account and I can work with your own files.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {services.map((service) => (
          <Link
            className={buttonVariants({ size: "sm" })}
            href={service.connectHref}
            key={service.id}
          >
            Connect {service.name}
          </Link>
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

/** Every declared kind, rendered. Total by type: adding a key above without a
 * renderer here is a compile error. */
const AGENT_PART_RENDERERS: {
  [K in keyof AgentDataParts]: (data: AgentDataParts[K]) => ReactNode;
} = {
  connect: (data) => <ConnectPart {...data} />,
  "mcp-config": () => <McpConfigPart />,
  "account-state": (data) => <AccountStatePart {...data} />,
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
  const kind = type.slice("data-".length) as keyof AgentDataParts;
  const render = AGENT_PART_RENDERERS[kind] as
    | ((data: unknown) => ReactNode)
    | undefined;
  return render ? render(data) : null;
}
