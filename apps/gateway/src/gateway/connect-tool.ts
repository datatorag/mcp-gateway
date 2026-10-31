/**
 * The `connect` built-in's answer (SCRUM-466): which of the user's providers
 * are connected, as which accounts, and a one-click connect link for each
 * that is not. Kept apart from the server so it can be read and tested on
 * its own; the registry entry in `mcp-server.ts` only hands it its inputs.
 *
 * When everything is connected the answer is one sentence and no link is
 * made. Naming a `service` asks for a link even when it is connected, which
 * is how a second account of the same provider is added.
 */
import type { Database } from "@datatorag-mcp/db";
import { CONNECTABLE_SERVICES, offeredServices } from "../app/dashboard/connections/service-registry";
import { listConnectedAccounts } from "./connected-accounts";
import { launchedServiceIds } from "./service-launch";
import { connectionDead } from "./refresh-failure";
import { cleanWorkspaceName } from "./untrusted-text";
import { CONNECT_LINK_LEAD } from "./not-connected";

export const CONNECT_TOOL = "connect";

export const CONNECT_TOOL_DESCRIPTION =
  "Shows which of the user's Google Workspace, Atlassian and Notion accounts are connected, and gives a one-click link to connect each one that is not. " +
  "Call it first when you do not know what is connected, and whenever a tool says a provider is not connected. " +
  "Each provider's tools are only listed once it is connected. " +
  "Pass service to get a link for that provider even when it is already connected, to add another account. " +
  "The link is for the user to open in their browser: it works once and expires after ten minutes.";

/** The words of the answer, in one place for review. */
export const CONNECT_TOOL_COPY = {
  allConnected: (names: string) => `${names} ${names.includes(" and ") ? "are all" : "is"} connected. Nothing to do.`,
  connectedAs: (name: string, accounts: string) => `${name}: connected as ${accounts}`,
  notConnected: (name: string) => `${name}: not connected.`,
  needsReconnect: "needs reconnecting",
  reconnectLead: "Reconnect it here:",
  anotherLead: "Connect another account here:",
  linkFailed: "A link could not be made just now; try again in a moment.",
  unknownService: (value: string) => `There is no service called ${value} to connect.`,
} as const;

export type ConnectToolProvider = {
  id: string;
  name: string;
  connected: boolean;
  accounts: Array<{ email: string; workspace?: string; is_default: boolean; needs_reconnect?: true }>;
  connect_url: string | null;
};

/** "A", "A and B", "A, B and C". */
export function listOf(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export async function connectToolResult(
  db: Database,
  userId: string,
  service: unknown,
  /** A link for a provider; `prompt` asks for it to go out as a URL
   * elicitation too, which is never awaited (SCRUM-466). */
  issueLink: (service: string, prompt: boolean) => Promise<string | null>
): Promise<{
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}> {
  const launched = offeredServices(CONNECTABLE_SERVICES, await launchedServiceIds(db));
  const asked = service === undefined || service === null || service === "" ? null : service;
  const providers = asked === null ? launched : launched.filter((s) => s.id === asked);
  if (asked !== null && providers.length === 0) {
    return {
      content: [{ type: "text", text: CONNECT_TOOL_COPY.unknownService(String(asked).slice(0, 60)) }],
      isError: true,
    };
  }

  const rows = await listConnectedAccounts(db, userId);
  // At most one prompt, for the named provider or the first one not
  // connected; never for a provider that is connected and working, whose
  // link is only for adding another account.
  const target = asked ?? providers.find((p) => !rows.some((r) => r.connectorType === p.id))?.id ?? null;
  const report: ConnectToolProvider[] = [];
  const lines: string[] = [];
  for (const p of providers) {
    const accounts = rows
      .filter((r) => r.connectorType === p.id)
      .map((r) => {
        const workspace = r.externalAccountId ? cleanWorkspaceName(r.label) : null;
        return {
          email: r.accountEmail,
          ...(workspace ? { workspace } : {}),
          is_default: r.isDefault,
          ...(connectionDead(p.id, r) ? { needs_reconnect: true as const } : {}),
        };
      });
    const connected = accounts.length > 0;
    const broken = accounts.some((a) => a.needs_reconnect);
    const wantsLink = !connected || broken || asked !== null;
    const link = wantsLink ? await issueLink(p.id, p.id === target && (!connected || broken)) : null;
    report.push({ id: p.id, name: p.name, connected, accounts, connect_url: link });

    const linkPart = (lead: string) => (link ? ` ${lead} ${link}` : wantsLink ? ` ${CONNECT_TOOL_COPY.linkFailed}` : "");
    if (!connected) {
      lines.push(`${CONNECT_TOOL_COPY.notConnected(p.name)}${linkPart(CONNECT_LINK_LEAD)}`);
      continue;
    }
    const names = accounts
      .map((a) => {
        const marks = [a.is_default ? "default" : null, a.needs_reconnect ? CONNECT_TOOL_COPY.needsReconnect : null].filter(Boolean);
        const who = a.workspace ? `${a.email} in ${a.workspace}` : a.email;
        return marks.length > 0 ? `${who} (${marks.join(", ")})` : who;
      })
      .join(", ");
    const lead = broken ? CONNECT_TOOL_COPY.reconnectLead : CONNECT_TOOL_COPY.anotherLead;
    lines.push(`${CONNECT_TOOL_COPY.connectedAs(p.name, names)}.${linkPart(lead)}`);
  }

  const allConnected = asked === null && report.every((p) => p.connected && p.connect_url === null && !p.accounts.some((a) => a.needs_reconnect));
  const text = allConnected ? CONNECT_TOOL_COPY.allConnected(listOf(report.map((p) => p.name))) : lines.join("\n");
  return { content: [{ type: "text", text }], structuredContent: { providers: report } };
}
