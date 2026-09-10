import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  GetPromptRequestSchema,
  ListPromptsRequestSchema,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { getAllSkills } from "@/lib/skills";
import {
  findSkill,
  searchSkills,
  skillApplyText,
  skillSummary,
  echoName,
  topResultKind,
} from "./skills-catalogue";
import { listConnectedServiceIds } from "./connected-services";
import { trackSkillApplied, trackSkillEvent, trackSkillSearched } from "./track";
import { gwsRunFields } from "./usage/gws-run-fields";
import { EVENTS } from "../lib/analytics";
import { createUserSkill, deleteUserSkill, forkSkill, updateUserSkill, type WriteResult } from "./skills/catalogue-store";
import { eq, and } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers, pluginConnections } from "@datatorag-mcp/db";
import type { ConnectionPool } from "./pool";
import { NAMESPACE_SEPARATOR } from "./plugin-manager";
import { PLUGIN_SERVICE_MAP, resolveServiceToken } from "./service-token";
import {
  listUserToolRows,
  buildPluginServerUrl,
  callPluginToolOnce,
} from "./user-tools";
import {
  accountsGrantingScope,
  listConnectedAccounts,
} from "./connected-accounts";
import { trackToolCall } from "./track";
import { trackMcpToolsListed } from "./mcp-analytics";
import { checkCallAllowance } from "./billing/enforce";
import {
  checkScopeForTool,
  missingScopeMessage,
  rewriteScopeError,
  MISSING_SCOPE_ERROR_MARKER,
} from "./scope-grant";

const ACCOUNT_PARAM_SCHEMA = {
  type: "string",
  description:
    "Optional email address of the connected account to use (e.g. 'user@gmail.com'). If omitted, the default account is used.",
} as const;

/**
 * SCRUM-225: which service a tool answer says is not usable, or null.
 *
 * The scheduler reads a run's tool results through this so it can pause a
 * schedule with "reconnect needed" naming the service. It lives beside the
 * three sentences it recognises (the not-connected answer, the unknown-account
 * answer and the scope refusal, all below) so the wording and the recogniser
 * change in one file. Every one of them carries the connect URL with the
 * service as its last segment, and that is what is read.
 */
export function connectionFailureService(text: string): string | null {
  if (
    !/ is not connected\. Please connect it/.test(text) &&
    !text.startsWith("No connected account found for ") &&
    !text.includes(MISSING_SCOPE_ERROR_MARKER)
  ) {
    return null;
  }
  const m = /\/dashboard\/connections\/([a-z0-9-]+)/.exec(text);
  return m?.[1] ?? "unknown";
}

/** The fields a user's skill is saved from (SCRUM-226); one definition for
 * skills_create and skills_update. */
const SKILL_FIELDS = {
  title: { type: "string", description: "Query-shaped, like a published skill's title." },
  situation: { type: "string", description: "The problem, in your words. Optional." },
  produces: { type: "string", description: "What the run produces. Optional." },
  source: { type: "string", description: "The skill file itself, markdown with frontmatter." },
  tools: { type: "array", items: { type: "string" }, description: "The tools it uses, by name." },
  accounts: { type: "string", enum: ["single", "multiple"], description: "Optional; single by default." },
} as const;

/** The answer to a write: the saved skill's identity, or the reason it was
 * refused in plain words, never an error. */
function writeAnswer(result: WriteResult, verb: string): string {
  if (result.ok) {
    return JSON.stringify({
      [verb]: true,
      slug: result.skill.slug,
      version: result.skill.version,
      layer: result.skill.layer,
      title: result.skill.title,
      forkedFrom: result.skill.forkedFrom,
      note:
        result.skill.layer === "yours"
          ? "This is your version. It runs in place of any published skill with the same slug, for you only."
          : undefined,
    });
  }
  switch (result.reason) {
    case "invalid":
      return `Not ${verb}: ${result.field}: ${result.error}.`;
    case "cap":
      return `Not ${verb}: you already have ${result.cap} skills of your own, which is the limit. Delete one first.`;
    case "exists":
      return `Not ${verb}: you already have your version of that skill. Update it with skills_update, or delete it to start again.`;
    case "not_found":
    default:
      return `No skill of yours by that slug${verb === "forked" ? ", and no published skill either" : ""}. Call skills_search to see what you have.`;
  }
}

type BuiltinResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

/**
 * Gateway built-in tools — served by this process, no plugin behind them.
 *
 * This registry IS the metering boundary for built-ins (SCRUM-66).
 * ListTools appends exactly these definitions, and CallTool dispatches every
 * name found here through one shared path that emits a tool_call event with
 * `builtin: true` — which classifies to metered:false, so the event reaches
 * analytics and neither billing sink runs (see usage/classify.ts). Before the
 * registry, the two built-ins were handled inline and emitted nothing; that
 * silence was undocumented, so a third built-in would have inherited it by
 * default. An entry added here inherits emission and non-metering by
 * construction, and mcp-server.builtins.test.ts iterates the registry, so a
 * new entry is covered without anyone remembering to cover it.
 */
export const BUILT_IN_TOOLS: {
  definition: {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
  };
  /** DECLARED approval requirement (SCRUM-188), read by the agent's tool
   * wrapper. Built-ins live outside the plugin registry, so the name-based
   * classifier's snapshot suites must never carry them — the declaration
   * lives here, in the same object a new built-in is added to, so
   * classification cannot be forgotten separately from creation. A parity
   * test asserts every entry declares one. "read" runs unprompted; anything
   * that changes state declares "write" and gets the confirm card. */
  approval: "read" | "write";
  handler: (
    args: Record<string, unknown> | undefined,
    ctx: { db: Database; userId: string; connectionsUrl: string }
  ) => Promise<BuiltinResult>;
}[] = [
  /* THE SKILL CATALOGUE AS TOOLS (SCRUM-224), for clients that render tools
   * only. Both read the one catalogue the public pages, the dashboard and
   * the prompts read; `skills_get` hands over EXACTLY the text the prompt
   * hands over, so a model gets the same bytes whichever door it came
   * through. Noun-first names, per HQ decision, so they read like every
   * other registry tool. Read-only: they change nothing anywhere. */
  {
    approval: "read",
    definition: {
      name: "skills_search",
      description:
        "Search the published skill catalogue: routines that tell an assistant what to do with the user's connected accounts and in what order. Returns each matching skill's slug, title, the situation it is for, what it produces, the tools it uses, the services it needs, and whether this user has them connected. Call skills_get with a slug to load one into this session.",
      inputSchema: {
        type: "object" as const,
        properties: {
          query: {
            type: "string",
            description:
              "Free text matched against titles, situations, outcomes and tool names. Omit to list every skill.",
          },
        },
      },
    },
    handler: async (args, { db, userId }) => {
      const query = typeof args?.query === "string" ? args.query : null;
      const [matches, connected] = await Promise.all([
        searchSkills(userId, query),
        listConnectedServiceIds(db, userId),
      ]);
      // Search text is user content: the event carries its length, the
      // result count and the top result's kind, never the string.
      void trackSkillSearched(db, userId, {
        queryLength: (query ?? "").length,
        results: matches.length,
        topResult: topResultKind(matches),
        surface: "mcp",
      });
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              skills: matches.map((skill) => skillSummary(skill, connected)),
              how_to_apply: "Call skills_get with a slug; follow the returned skill exactly as written.",
            }),
          },
        ],
      };
    },
  },
  {
    approval: "read",
    definition: {
      name: "skills_get",
      description:
        "Load one published skill into this session. Returns the skill file to follow, prefaced by which of its services this user has connected and which account the run will use. Pass account (one of the user's connected addresses) to choose; otherwise the default account is used.",
      inputSchema: {
        type: "object" as const,
        properties: {
          slug: { type: "string", description: "The skill's slug, from skills_search." },
          account: {
            type: "string",
            description: "Optional. The connected account the skill should run against.",
          },
        },
      },
    },
    handler: async (args, { db, userId, connectionsUrl }) => {
      const skill = await findSkill(userId, args?.slug);
      if (!skill) {
        // Not an error: a model that guessed a slug gets the real list, the
        // same way an empty search would, and nothing is applied or counted.
        return {
          content: [
            {
              type: "text" as const,
              text:
                `No skill named ${JSON.stringify(echoName(args?.slug))}, published or yours. Available slugs: ` +
                (await getAllSkills(userId))
                  .map((s) => s.slug)
                  .join(", ") +
                ". Call skills_search to see what each one does.",
            },
          ],
        };
      }
      const applied = await applySkillFor(db, userId, skill.slug, args?.account, connectionsUrl);
      void trackSkillApplied(db, userId, {
        skill: skill.slug,
        via: "tool",
        surface: "mcp",
        runnable: applied.runnable,
      });
      return { content: [{ type: "text" as const, text: applied.text }] };
    },
  },
  /* A USER'S OWN SKILLS (SCRUM-226). Four write built-ins, declared write so
   * the agent prompts before them, sharing the store's functions with the
   * dashboard routes. A refusal is a plain answer the model can act on (the
   * field, the cap, the missing skill), never an error: the same shape
   * skills_get uses for an unknown slug. Every change reports its event. */
  {
    approval: "write",
    definition: {
      name: "skills_create",
      description:
        "Save a new skill of your own: a routine the agent can run for you on your connected accounts. Private to you. Takes the title, the situation it is for, what it produces, the skill file (markdown, the same shape as a published skill), the tools it uses, and whether it runs on a single account or multiple. Answers with the slug and version.",
      inputSchema: {
        type: "object" as const,
        properties: SKILL_FIELDS,
        required: ["title", "source", "tools"],
      },
    },
    handler: async (args, { db, userId }) => {
      const result = await createUserSkill(db, userId, args ?? {});
      if (result.ok) {
        void trackSkillEvent(db, userId, EVENTS.SKILL_CREATED, { skill: result.skill.slug, via: "tool" });
      }
      return { content: [{ type: "text" as const, text: writeAnswer(result, "created") }] };
    },
  },
  {
    approval: "write",
    definition: {
      name: "skills_update",
      description:
        "Save a new version of one of your own skills. Every save is a new immutable version; the previous one is kept. Takes the slug and the same fields as skills_create. A published skill cannot be edited: fork it first with skills_fork.",
      inputSchema: {
        type: "object" as const,
        properties: { slug: { type: "string", description: "The slug of your skill." }, ...SKILL_FIELDS },
        required: ["slug", "title", "source", "tools"],
      },
    },
    handler: async (args, { db, userId }) => {
      const slug = typeof args?.slug === "string" ? args.slug : "";
      const result = await updateUserSkill(db, userId, slug, args ?? {});
      if (result.ok) {
        void trackSkillEvent(db, userId, EVENTS.SKILL_UPDATED, { skill: result.skill.slug, via: "tool" });
      }
      return { content: [{ type: "text" as const, text: writeAnswer(result, "updated") }] };
    },
  },
  {
    approval: "write",
    definition: {
      name: "skills_fork",
      description:
        "Copy a published skill into your own skills, keeping its slug, so your version runs in its place for you. Records which published version it came from. Edit the copy with skills_update; delete it with skills_delete to get the published one back.",
      inputSchema: {
        type: "object" as const,
        properties: { slug: { type: "string", description: "The published skill's slug, from skills_search." } },
        required: ["slug"],
      },
    },
    handler: async (args, { db, userId }) => {
      const slug = typeof args?.slug === "string" ? args.slug : "";
      const result = await forkSkill(db, userId, slug);
      if (result.ok) {
        void trackSkillEvent(db, userId, EVENTS.SKILL_FORKED, { skill: result.skill.slug, via: "tool" });
      }
      return { content: [{ type: "text" as const, text: writeAnswer(result, "forked") }] };
    },
  },
  {
    approval: "write",
    definition: {
      name: "skills_delete",
      description:
        "Delete one of your own skills. If it was your version of a published skill, the published one is available to you again.",
      inputSchema: {
        type: "object" as const,
        properties: { slug: { type: "string", description: "The slug of your skill." } },
        required: ["slug"],
      },
    },
    handler: async (args, { db, userId }) => {
      const slug = typeof args?.slug === "string" ? args.slug : "";
      const deleted = await deleteUserSkill(db, userId, slug);
      if (!deleted) {
        return {
          content: [{ type: "text" as const, text: `No skill of yours named ${JSON.stringify(echoName(slug))}. Call skills_search to see your skills.` }],
        };
      }
      void trackSkillEvent(db, userId, EVENTS.SKILL_DELETED, { skill: deleted.slug, via: "tool", shadowed: deleted.shadowed });
      return {
        content: [
          {
            type: "text" as const,
            text: deleted.shadowed
              ? `Deleted your version of ${deleted.slug}. The published skill is available to you again.`
              : `Deleted your skill ${deleted.slug}.`,
          },
        ],
      };
    },
  },
  {
    approval: "read",
    definition: {
      name: "list_connected_accounts",
      description:
        "List the user's connected accounts grouped by service. Use this to discover which accounts are available before passing the 'account' parameter to other tools.",
      inputSchema: {
        type: "object" as const,
        properties: {},
      },
    },
    handler: async (_args, { db, userId }) => {
      const rows = await listConnectedAccounts(db, userId);

      if (rows.length === 0) {
        return {
          content: [
            {
              type: "text" as const,
              text: "No connected accounts. The user can connect accounts at /dashboard/connections.",
            },
          ],
        };
      }

      const grouped: Record<
        string,
        { email: string; label: string | null; is_default: boolean; connected_at: string }[]
      > = {};
      for (const row of rows) {
        const key = row.connectorType;
        if (!grouped[key]) grouped[key] = [];
        grouped[key].push({
          email: row.accountEmail,
          label: row.label,
          is_default: row.isDefault,
          connected_at: row.connectedAt.toISOString().split("T")[0],
        });
      }

      return {
        content: [{ type: "text" as const, text: JSON.stringify(grouped) }],
      };
    },
  },
  {
    approval: "read",
    definition: {
      name: "echo",
      description:
        "Echo back the input message. A built-in test tool to verify the gateway is working.",
      inputSchema: {
        type: "object" as const,
        properties: {
          message: {
            type: "string",
            description: "The message to echo back",
          },
        },
        required: ["message"],
      },
    },
    handler: async (args) => ({
      content: [
        {
          type: "text" as const,
          text: `[datatorag-mcp echo] ${args?.message ?? "(no message)"}`,
        },
      ],
    }),
  },
];

/**
 * A skill, applied to this user's session (SCRUM-224): the connection
 * preface (what the skill needs, what is connected, which account the run
 * will use) and the verbatim run message. One function, called by the
 * prompt handler and the tool handler, which is what makes their answers
 * byte-identical. The connected set is the shared definition the tool list
 * uses, so "does this user have what this needs" is answered one way.
 */
async function applySkillFor(
  db: Database,
  userId: string,
  slug: string,
  account: unknown,
  connectionsUrl: string
): Promise<{ text: string; runnable: boolean }> {
  const skill = (await findSkill(userId, slug))!;
  const [connected, accounts] = await Promise.all([
    listConnectedServiceIds(db, userId),
    listConnectedAccounts(db, userId),
  ]);
  const summary = skillSummary(skill, connected);
  const text = skillApplyText(skill, {
    connected,
    accounts: accounts.map((a) => ({
      connectorType: a.connectorType,
      accountEmail: a.accountEmail,
      isDefault: a.isDefault,
    })),
    account: typeof account === "string" ? account : null,
    connectionsUrl,
    // SCRUM-242: the server's time; an MCP client offers no zone.
    clock: { now: new Date(), zone: null },
  });
  return { text, runnable: summary.runnable };
}

/**
 * Creates a new MCP Server instance for a client session.
 * Dynamically serves tools from the registry and routes calls to backend
 * processes (local plugins) or Docker containers.
 */
export function createMcpServer(
  userId: string,
  db: Database,
  pool: ConnectionPool,
  opts?: {
    /** Absolute origin for links in user-facing tool errors (SCRUM-136).
     * Optional so tests and legacy call sites fall back to a relative path. */
    baseUrl?: string;
    /** Which audience reads this server's refusal wording (SCRUM-188). The
     * scope-gate POLICY is identical either way; only the message differs:
     * "mcp" (default) points at the dashboard URL because an external client
     * can render nothing else, "agent" instructs the model to offer the
     * inline reconnect control it can actually show. Set to "agent" only by
     * the in-process construction. */
    surface?: "mcp" | "agent";
    /** The OAuth client id of the credential this session authenticated
     * with (SCRUM-189). Stamped as client_id on every tool_call event; the
     * self-reported clientInfo.name from the initialize handshake rides
     * beside it as client_name. Note client_id identifies a REGISTRATION
     * (dynamic registration mints a fresh id per register call), so
     * client_name is the product-ish axis and client_id the stable one. */
    clientId?: string;
  }
): Server {
  const connectionsUrl = `${opts?.baseUrl ?? ""}/dashboard/connections`;
  const surface = opts?.surface ?? "mcp";
  const clientId = opts?.clientId ?? null;
  const server = new Server(
    { name: "datatorag-mcp", version: "0.1.0" },
    // Prompts (SCRUM-224): the skill catalogue as the native "apply a
    // reusable instruction to this session" primitive, for clients that
    // render it. The same catalogue is served as tools for clients that do
    // not; see BUILT_IN_TOOLS.
    { capabilities: { tools: {}, prompts: {} } }
  );
  /** Self-reported by the client at initialize; undefined until the
   * handshake completes, which is before any tool call can arrive. */
  const clientName = () => server.getClientVersion()?.name ?? null;

  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: (await getAllSkills(userId)).map((skill) => ({
      name: skill.slug,
      title: skill.title,
      description: `${skill.situation} ${skill.produces}`,
      arguments: [
        {
          name: "account",
          description:
            "Optional. The connected account to run against; the default account is used otherwise, and the prompt names the one it chose.",
          required: false,
        },
      ],
    })),
  }));

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    const skill = await findSkill(userId, name);
    if (!skill) {
      // A prompt name is an identifier into the one catalogue; an unknown one
      // is a client error, never a guess.
      throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${JSON.stringify(echoName(name))}`);
    }
    const applied = await applySkillFor(db, userId, skill.slug, args?.account, connectionsUrl);
    void trackSkillApplied(db, userId, {
      skill: skill.slug,
      via: "prompt",
      surface,
      runnable: applied.runnable,
    });
    return {
      description: skill.title,
      messages: [{ role: "user" as const, content: { type: "text" as const, text: applied.text } }],
    };
  });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    // Shared connected-service policy — see user-tools.ts. This handler only
    // shapes the rows for MCP: inject the `account` param on service-backed
    // tools and append the built-in tools.
    const rows = await listUserToolRows(db, userId);

    const toolList: {
      name: string;
      description: string;
      inputSchema: Record<string, unknown>;
    }[] = [];

    for (const t of rows) {
      if (t.requiredService) {
        const properties = {
          ...(t.schema.properties as Record<string, unknown>),
          account: ACCOUNT_PARAM_SCHEMA,
        };
        toolList.push({
          name: t.namespacedName,
          description: t.description,
          inputSchema: { ...t.schema, properties },
        });
      } else {
        toolList.push({
          name: t.namespacedName,
          description: t.description,
          inputSchema: t.schema,
        });
      }
    }

    for (const t of BUILT_IN_TOOLS) toolList.push(t.definition);

    // A user who lists tools and then stops is a very different activation
    // signal from one whose client never connected. Count only — never the
    // tool list itself.
    void trackMcpToolsListed(db, userId, toolList.length);

    return { tools: toolList };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: rawArgs } = request.params;

    const builtin = BUILT_IN_TOOLS.find((t) => t.definition.name === name);
    if (builtin) {
      const startTime = Date.now();
      try {
        const result = await builtin.handler(
          rawArgs as Record<string, unknown> | undefined,
          { db, userId, connectionsUrl }
        );
        // Same fire-and-forget shape as the plugin path below. This call
        // going missing is a real regression we have shipped before: built-ins
        // answered on the wire and were absent from analytics entirely, which
        // reads as nobody using them rather than as a hole in the
        // instrumentation. `builtin: true` classifies to metered:false, so the
        // event is emitted and the billing sinks never run.
        void trackToolCall(db, {
          userId,
          clientId,
          clientName: clientName(),
          toolName: name,
          connectorType: null,
          accountEmail: undefined,
          latencyMs: Date.now() - startTime,
          responseSizeBytes: JSON.stringify(result).length,
          errorMessage: null,
          outcome: { thrown: false, isError: false, source: "mcp", toolName: name, builtin: true },
        });
        return result;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown error";
        console.error(`[route-error] builtin ${name}:`, message);
        void trackToolCall(db, {
          userId,
          clientId,
          clientName: clientName(),
          toolName: name,
          connectorType: null,
          accountEmail: undefined,
          latencyMs: Date.now() - startTime,
          responseSizeBytes: null,
          errorMessage: message,
          outcome: { thrown: true, errorMessage: message, source: "mcp", toolName: name, builtin: true },
        });
        return {
          content: [
            {
              type: "text" as const,
              text: `Error calling ${name}: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }

    // Allowance gate, BEFORE any dispatch work. Built-ins are above this line
    // on purpose — they are unmetered connectivity probes and must keep
    // answering for a capped user. A refusal here is a product state, not an
    // error: the call never dispatches, is never metered, and the message
    // tells the user what resets and what upgrades.
    const allowance = await checkCallAllowance(db, userId);
    if (!allowance.allowed) {
      return {
        content: [{ type: "text" as const, text: allowance.message }],
        isError: true,
      };
    }

    const args = rawArgs as Record<string, unknown>;
    // SCRUM-227: a gws_run call is named by its service and method on the
    // event and the row; the arguments themselves never leave this handler.
    const runFields = gwsRunFields(name, args);

    const separatorIndex = name.indexOf(NAMESPACE_SEPARATOR);
    if (separatorIndex === -1) {
      return {
        content: [
          { type: "text" as const, text: `Unknown tool: ${JSON.stringify(echoName(name))}` },
        ],
        isError: true,
      };
    }

    const serverSlug = name.slice(0, separatorIndex);
    const toolName = name.slice(separatorIndex + NAMESPACE_SEPARATOR.length);

    const [mcpServer] = await db
      .select({
        id: mcpServers.id,
        slug: mcpServers.slug,
        containerPort: mcpServers.containerPort,
        githubRepoUrl: mcpServers.githubRepoUrl,
      })
      .from(mcpServers)
      .where(eq(mcpServers.slug, serverSlug))
      .limit(1);

    if (!mcpServer) {
      return {
        content: [
          {
            type: "text" as const,
            text: `Unknown server: ${JSON.stringify(echoName(serverSlug))}`,
          },
        ],
        isError: true,
      };
    }

    const serverUrl = buildPluginServerUrl(mcpServer);

    // Look up per-user token: first check service connections, then legacy plugin connections
    let userToken: string | null = null;

    const requiredService = PLUGIN_SERVICE_MAP[mcpServer.slug];
    // SCRUM-147: scope refusals link the SERVICE page, because that is where
    // the account controls live — the bare connections URL redirects to the
    // overview, which cannot switch a default. An error that names a fix has
    // to land on the page that offers it.
    const grantFixUrl = requiredService
      ? `${connectionsUrl}/${requiredService}`
      : connectionsUrl;
    let accountEmail: string | undefined;
    if (requiredService) {
      const requestedAccount = args.account as string | undefined;
      delete args.account;

      const resolved = await resolveServiceToken(
        db,
        userId,
        requiredService,
        requestedAccount
      );
      userToken = resolved?.token ?? null;
      // The account STAMPED on the usage event is the one the resolution
      // actually chose, not the caller's argument:
      // with the argument omitted the gateway still picks the default
      // account, and discarding that identity left every argument-less call
      // unattributable — the exact field metered billing would bill on. When
      // an argument was given, resolution only succeeds on that same account,
      // so the two agree; the legacy path has no account and reports the
      // request as made.
      accountEmail = resolved?.accountEmail ?? requestedAccount;
      if (!userToken) {
        const msg = requestedAccount
          ? `No connected account found for ${echoName(requestedAccount)}. Please connect it from the dashboard at ${grantFixUrl}.`
          : `${requiredService} is not connected. Please connect it from the dashboard at ${grantFixUrl} before using ${serverSlug} tools.`;
        return {
          content: [{ type: "text" as const, text: msg }],
          isError: true,
        };
      }

      // SCRUM-136/107: refuse BEFORE dispatch when the scope this tool needs
      // is known-missing from the account the call would run as. The user
      // reads which access they did not grant and where to grant it, never a
      // raw Google 403. Fail-open by construction: unmapped tools and legacy
      // rows fall through to the call (the post-call rewrite is their net).
      const scopeCheck = checkScopeForTool({
        toolName,
        service: requiredService,
        granted: resolved?.scopes ?? null,
        surface,
        connectionsUrl: grantFixUrl,
      });
      if (!scopeCheck.ok) {
        // SCRUM-145: the refusal names the account it judged and, when
        // another connected account holds the scope, names that too — "Gmail
        // not granted" alone is actively misleading to a user who just
        // granted Gmail on a different account. Enrichment only: a failed
        // lookup falls back to the plain refusal, never to a crash.
        let refusalText = scopeCheck.message;
        try {
          const alternates = await accountsGrantingScope(
            db,
            userId,
            requiredService,
            scopeCheck.missing.scope,
            accountEmail ?? null
          );
          refusalText = missingScopeMessage({
            displayName: scopeCheck.missing.displayName,
            surface,
            connectionsUrl: grantFixUrl,
            accountEmail,
            alternates,
          });
        } catch {
          // scopeCheck.message stands.
        }
        // Metered with a distinct marker: a refusal the instrumentation
        // cannot see would be a one-sided measurement of exactly the failure
        // this exists to fix.
        void trackToolCall(db, {
          userId,
          clientId,
          clientName: clientName(),
          toolName: name,
          connectorType: requiredService,
          accountEmail,
          ...runFields,
          latencyMs: 0,
          responseSizeBytes: null,
          errorMessage: `${MISSING_SCOPE_ERROR_MARKER} ${scopeCheck.missing.displayName} not granted`,
          outcome: {
            thrown: false,
            isError: true,
            errorMessage: `${MISSING_SCOPE_ERROR_MARKER} ${scopeCheck.missing.displayName} not granted`,
            source: "mcp",
            toolName: name,
          },
        });
        return {
          content: [{ type: "text" as const, text: refusalText }],
          isError: true,
        };
      }
    } else if (mcpServer.githubRepoUrl) {
      // Legacy: check pluginConnections table
      const [conn] = await db
        .select({ accessToken: pluginConnections.accessToken })
        .from(pluginConnections)
        .where(
          and(
            eq(pluginConnections.userId, userId),
            eq(pluginConnections.mcpServerId, mcpServer.id)
          )
        )
        .limit(1);
      if (conn) {
        userToken = conn.accessToken;
      }
    }

    console.log(
      `[route] ${name} → ${serverUrl} (tool: ${toolName}, token: ${userToken ? "yes" : "no"})`
    );

    const startTime = Date.now();

    try {
      let result;
      if (userToken) {
        result = await callPluginToolOnce({
          serverUrl,
          userToken,
          toolName,
          args: args as Record<string, unknown>,
          clientName: "datatorag-mcp",
        });
      } else {
        const pooledClient = await pool.acquire(mcpServer.id, serverUrl);
        try {
          result = await pooledClient.callTool({
            name: toolName,
            arguments: args as Record<string, unknown>,
          });
        } finally {
          pool.release(mcpServer.id, pooledClient);
        }
      }

      const responseText = JSON.stringify(result);
      const isError = !!(result as { isError?: boolean }).isError;
      const content = (result as { content?: Array<{ type: string; text?: string }> }).content;
      const errorMessage = isError
        ? content
            ?.filter((c) => c.type === "text")
            .map((c) => c.text)
            .join(" ") ?? null
        : null;

      // SCRUM-136: the at-failure net behind the pre-call check. A Google
      // insufficient-scope 403 that slipped through (unmapped tool, stale
      // row) reaches the user in words with a reconnect path; the RAW error
      // is what the usage row and the server log keep — the truth is metered,
      // the words are served.
      const scopeRewrite = rewriteScopeError({
        toolName,
        service: requiredService ?? null,
        errorText: errorMessage,
        surface,
        connectionsUrl: grantFixUrl,
      });
      if (scopeRewrite) {
        console.warn(`[scope-error] ${name}: ${errorMessage}`);
        result = {
          ...(result as Record<string, unknown>),
          content: [{ type: "text" as const, text: scopeRewrite }],
        };
      }
      // Fire-and-forget: metering must never slow the tool response. Latency
      // and sizes are already captured into the props here; trackToolCall is
      // self-contained (never throws) so the floating promise is safe.
      void trackToolCall(db, {
        userId,
        clientId,
        clientName: clientName(),
        toolName: name,
        connectorType: requiredService ?? null,
        accountEmail,
        ...runFields,
        latencyMs: Date.now() - startTime,
        responseSizeBytes: responseText.length,
        errorMessage,
        outcome: { thrown: false, isError, errorMessage, source: "mcp", toolName: name },
      });

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Unknown error";
      console.error(
        `[route-error] ${serverSlug}/${toolName} @ ${serverUrl}:`,
        message
      );

      // Fire-and-forget (see the success path above): metering off the response
      // path, self-contained and never throwing.
      void trackToolCall(db, {
        userId,
        clientId,
        clientName: clientName(),
        toolName: name,
        connectorType: requiredService ?? null,
        accountEmail,
        ...runFields,
        latencyMs: Date.now() - startTime,
        responseSizeBytes: null,
        errorMessage: message,
        outcome: { thrown: true, errorMessage: message, source: "mcp", toolName: name },
      });

      return {
        content: [
          {
            type: "text" as const,
            text: `Error calling ${echoName(serverSlug)}/${echoName(toolName)}: ${message}`,
          },
        ],
        isError: true,
      };
    }
  });

  return server;
}
