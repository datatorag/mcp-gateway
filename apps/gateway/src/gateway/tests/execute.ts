import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Database, TestRunScope, TestRunTotals } from "@datatorag-mcp/db";
import { getEnv } from "@datatorag-mcp/config";
import { createMcpServer, BUILT_IN_TOOLS } from "../mcp-server";
import type { ConnectionPool } from "../pool";
import { classifyWrite } from "../playground/tools";
import { checkContract, type ContractSubject } from "./contract";
import { createHttpFetcher, loopbackBase } from "./http";
import { classifyTools, nonAdminView, registrySurface } from "./surface";
import { CASES } from "./cases";
import { orderByNeeds, runOneCase, type ContextParts } from "./runner";
import { runPool } from "./pool";
import { parseFixtureMap } from "./fixtures";
import { checkSend, type GuardLookups } from "./send-guard";
import type { AccountRole, FixtureKey } from "./types";
import { finishRun, recordResult, startRun } from "./store";
import { missingCheckouts, readPluginShas } from "./plugin-sha";
import { mcpServers, serviceConnections } from "@datatorag-mcp/db";
import { PLUGIN_SERVICE_MAP } from "../service-token";
import { eq } from "drizzle-orm";
import { join } from "node:path";
import { homedir } from "node:os";

/**
 * A run, start to finish (SCRUM-303).
 *
 * THE RUNNER IS AN IN-PROCESS CLIENT OF OUR OWN TOOL LAYER. It builds the
 * gateway's MCP server for the triggering admin over a linked in-memory
 * transport, exactly as the dashboard agent does, so everything after the
 * bearer check is the real path: the tool filter, the dispatch, the scope
 * gate, the allowance check, metering, token resolution, the plugin call.
 *
 * It holds NO credential. An earlier design minted an API key per run; that
 * was reversed because a live admin credential held for twenty minutes is a
 * cost paid on every run to test a door one case can test. What this path
 * skips is the HTTP layer of `/mcp`, and the door case covers that.
 *
 * Nothing here is a model. A case passes by returning and fails by throwing.
 */

const PLUGINS_DIR = join(homedir(), ".datatorag", "plugins");

/**
 * How many contract probes run at once.
 *
 * The probes were SEQUENTIAL and that is what made the first baseline take
 * nine and a half minutes for 101 tools. Each probe is a real call: for a
 * service-mapped plugin it resolves a token, opens a one-shot client, and
 * the plugin then shells out to its own binary, which discovers the API
 * before refusing the empty arguments. None of that is work we control, and
 * all of it is waiting.
 *
 * Four, matching the case pool, because the constraint is the plugin process
 * at the other end rather than us.
 */
const PROBE_CONCURRENCY = 4;

export type RunnerClient = {
  listTools(): Promise<{ name: string; inputSchema?: Record<string, unknown> }[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<{
    content: { type: string; text?: string }[];
    isError?: boolean;
  }>;
  close(): Promise<void>;
};

/** The in-process pair. `testRunId` is what stamps this run's traffic on the
 * usage events, since nothing else distinguishes it from the admin's own. */
export async function createRunnerClient(
  db: Database,
  pool: ConnectionPool,
  userId: string,
  runId: string
): Promise<RunnerClient> {
  const server = createMcpServer(userId, db, pool, {
    baseUrl: getEnv().GATEWAY_BASE_URL,
    testRunId: runId,
  });
  const client = new Client({ name: "datatorag-test-runner", version: "0.1.0" }, { capabilities: {} });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);

  return {
    async listTools() {
      const { tools } = await client.listTools();
      return tools.map((t) => ({
        name: t.name,
        inputSchema: t.inputSchema as Record<string, unknown> | undefined,
      }));
    },
    async callTool(name, args) {
      const result = await client.callTool({ name, arguments: args });
      return result as { content: { type: string; text?: string }[]; isError?: boolean };
    },
    async close() {
      await client.close();
    },
  };
}

export type StartResult =
  | { ok: true; runId: string; cases: number }
  | { ok: false; reason: "already_running"; runId: string };

/**
 * Claims the run slot and returns at once; the run itself proceeds in the
 * background of this process, writing each result as it lands so a poll sees
 * progress rather than nothing until the end.
 */
export async function startTestRun(opts: {
  db: Database;
  pool: ConnectionPool;
  userId: string;
  trigger: "ui" | "mcp";
  scope: TestRunScope;
}): Promise<StartResult> {
  const env = getEnv();
  const selected = selectCases(opts.scope);

  const claim = await startRun(opts.db, {
    triggeredBy: opts.userId,
    trigger: opts.trigger,
    scope: opts.scope,
    environment: env.TEST_RUNNER_ENVIRONMENT,
    gatewaySha: env.GATEWAY_SHA || null,
    pluginShas: readPluginShas(PLUGINS_DIR, await activePluginSlugs(opts.db)),
  });
  if (!claim.ok) return claim;

  void driveRun({ ...opts, runId: claim.runId, selected }).catch(async (err) => {
    // A run that dies must not stay `running` and hold the slot. It says so
    // in its own row rather than only in a log nobody reads.
    console.error("[test-runner] run failed:", err);
    await recordResult(opts.db, claim.runId, {
      caseId: "run",
      kind: "case",
      status: "fail",
      cleanup: "none_needed",
      durationMs: 0,
      evidence: [`the run itself failed: ${err instanceof Error ? err.message : String(err)}`],
    }).catch(() => {});
    await finishRun(opts.db, claim.runId, {
      status: "aborted",
      totals: { pass: 0, fail: 1, skip: 0, uncovered: 0 },
      toolsServed: 0,
    }).catch(() => {});
  });

  return { ok: true, runId: claim.runId, cases: selected.length };
}

/** Cases the scope asks for. Neither field means everything. */
export function selectCases(scope: TestRunScope, all = CASES) {
  if (scope.caseIds?.length) {
    const wanted = new Set(scope.caseIds);
    return all.filter((c) => wanted.has(c.id));
  }
  if (scope.tier) return all.filter((c) => c.tier === scope.tier);
  return [...all];
}

async function driveRun(opts: {
  db: Database;
  pool: ConnectionPool;
  userId: string;
  runId: string;
  selected: ReturnType<typeof selectCases>;
}): Promise<void> {
  const { db, runId } = opts;
  const totals: TestRunTotals = { pass: 0, fail: 0, skip: 0, uncovered: 0 };
  /* WHAT THE SCRUB MUST NOT EAT. Filled once the gate knows what this run
   * serves. Tool names are 20+ characters often enough that the id pattern
   * ate them, which made a skip reason name nothing; the configured
   * addresses matter for the same reason on a send refusal. Nothing else
   * goes in here: an id this run created is exactly what the scrub is for. */
  const safe: string[] = [];
  const record = async (row: Parameters<typeof recordResult>[2]) => {
    await recordResult(db, runId, row, safe);
    if (row.status === "pass") totals.pass += 1;
    else if (row.status === "fail") totals.fail += 1;
    else if (row.status === "skip") totals.skip += 1;
    else totals.uncovered += 1;
  };

  const fixtures = parseFixtureMap(getEnv().TEST_RUNNER_FIXTURES);
  /** Plugin slug -> why this machine cannot exercise it. See `unusablePlugins`. */
  let unusable = new Map<string, string>();
  const client = await createRunnerClient(db, opts.pool, opts.userId, runId);
  let served: { name: string; inputSchema?: Record<string, unknown> }[] = [];

  try {
    // 1. GATE. If the front door or the tool list is broken, forty cascading
    // failures say nothing the first one did not.
    const http = createHttpFetcher(loopbackBase(getEnv().GATEWAY_PORT));
    const gate: string[] = [];
    try {
      const health = await http("/health");
      gate.push(`GET /health answered ${health.status}`);
      if (!health.ok) throw new Error(`/health answered ${health.status}`);
      served = await client.listTools();
      gate.push(`tools/list served ${served.length} tools`);
      safe.push(...served.map((t) => t.name), ...fixtures.configuredAddresses());

      // NOT A FAILURE, A NAMED GAP. A plugin active in the registry with no
      // checkout on this machine still has its tools advertised from the
      // registry, so the run would otherwise record `sha unknown` and let
      // A4's third leg fail with a pool error, neither of which says the
      // actual thing: it is not installed here.
      const absent = missingCheckouts(PLUGINS_DIR, await activePluginSlugs(db));
      if (absent.length > 0) {
        gate.push(`not installed on this machine: ${absent.join(", ")}`);
      }
      unusable = await unusablePlugins(db, opts.userId, absent);
      for (const [slug, why] of unusable) gate.push(`${slug}: ${why}`);
    } catch (err) {
      await record({
        caseId: "A0",
        kind: "case",
        status: "fail",
        cleanup: "none_needed",
        durationMs: 0,
        evidence: [...gate, `gate failed: ${err instanceof Error ? err.message : String(err)}`],
      });
      await finishRun(db, runId, { status: "aborted", totals, toolsServed: 0 });
      return;
    }

    // THE GATE IS RECORDED WHEN IT PASSES TOO. It held these lines only on
    // the way to an abort, so a healthy run kept no record of what the front
    // door answered, how many tools it served, or which plugins were not
    // installed. A fact worth aborting on is worth writing down when it is
    // fine, or the run cannot be compared with the next one.
    await record({
      caseId: "A0",
      kind: "case",
      status: "pass",
      cleanup: "none_needed",
      durationMs: 0,
      evidence: gate,
    });

    // 2. PLAN. A case whose dependency is not in this run is a skip naming
    // it, never a silent omission.
    const { order, unresolved } = orderByNeeds(opts.selected);
    for (const u of unresolved) {
      await record({
        caseId: u.caseId,
        kind: "case",
        status: "skip",
        cleanup: "none_needed",
        durationMs: 0,
        evidence: [u.reason],
      });
    }

    // 3. EXECUTE, four at a time, with locks honoured.
    const shared = new Map<string, Record<string, unknown>>();
    const failed = new Set<string>();

    const servedNames = new Set(served.map((t) => t.name));
    const runnable: typeof order = [];
    for (const testCase of order) {
      // A TOOL THIS RUN DOES NOT SERVE IS A MISSING PREREQUISITE, NOT A
      // PRODUCT FINDING. A case whose covered tool is absent from
      // tools/list would otherwise fail on "unknown tool", which reads as
      // "the connector is broken" when what actually happened is that the
      // registry on this database has no row for it. It has already
      // happened: sheets_query shipped and the dev branch's registry never
      // got the row, so every run there would have reported a working tool
      // as broken. A skip still counts against green, and it names the tool.
      // THE ENVIRONMENT, NOT THE PRODUCT. A plugin that is not installed on
      // this machine, or whose service this identity has never connected,
      // still has its tools in the registry and therefore in tools/list. So
      // the case runs, the call fails, and the run reports a working
      // connector as broken. B1 and C7 did exactly that. Neither fact is
      // about the code under test, and neither is fixed by looking at it.
      const blockedPlugins = pluginsBlocking(testCase, unusable);
      if (blockedPlugins.length > 0) {
        await record({
          caseId: testCase.id,
          kind: "case",
          status: "skip",
          cleanup: "none_needed",
          durationMs: 0,
          evidence: blockedPlugins.map(([slug, why]) => `${slug} cannot be exercised here: ${why}`),
        });
        failed.add(testCase.id);
        continue;
      }
      const unserved = unservedToolsFor(testCase, servedNames);
      if (unserved.length > 0) {
        await record({
          caseId: testCase.id,
          kind: "case",
          status: "skip",
          cleanup: "none_needed",
          durationMs: 0,
          evidence: [`this run does not serve ${unserved.join(", ")}, so the case has nothing to exercise`],
        });
        failed.add(testCase.id);
        continue;
      }
      const missing = missingMappingsFor(testCase, fixtures);
      if (missing.length > 0) {
        // A missing mapping SKIPS and names what was missing. It never falls
        // back to a default account: a case that silently ran as the wrong
        // account would report a pass about something nobody checked.
        await record({
          caseId: testCase.id,
          kind: "case",
          status: "skip",
          cleanup: "none_needed",
          durationMs: 0,
          evidence: [`this run has no mapping for ${missing.join(", ")}`],
        });
        failed.add(testCase.id);
        continue;
      }
      runnable.push(testCase);
    }

    const executed = await runPool(runnable, async (testCase) => {
      const blockedBy = (testCase.needs ?? []).filter((n) => failed.has(n));
      if (blockedBy.length > 0) {
        return {
          caseId: testCase.id,
          status: "skip" as const,
          cleanup: "none_needed" as const,
          durationMs: 0,
          evidence: [`${blockedBy.join(", ")} did not pass, so this case cannot run`],
          toolsCalled: [] as string[],
        };
      }
      const called: string[] = [];
      const outcome = await runOneCase(testCase, {
        runId,
        makeParts: () => makeContextParts({ client, fixtures, called, db: opts.db, pool: opts.pool }),
        toolsCalled: () => called,
      });
      if (outcome.status !== "pass") failed.add(testCase.id);
      // COVERAGE IS CHECKED IN BOTH DIRECTIONS, which is what lets a case
      // about the gateway itself declare nothing. Declaring a tool it never
      // called would overstate what the suite proves; calling one it never
      // declared would leave that tool reported as uncovered while a case
      // exercises it, which is the quieter of the two and the reason the
      // second half exists.
      const mismatch = coverageMismatch(testCase.covers, called);
      if (outcome.status === "pass" && mismatch.length > 0) {
        return { ...outcome, status: "fail" as const, evidence: [...outcome.evidence, ...mismatch] };
      }
      return outcome;
    });

    for (const { testCase, result, skipped } of executed) {
      if (skipped) {
        await record({
          caseId: testCase.id,
          kind: "case",
          status: "skip",
          cleanup: "none_needed",
          durationMs: 0,
          evidence: [skipped],
        });
        continue;
      }
      if (!result) continue;
      shared.set(testCase.id, shared.get(testCase.id) ?? {});
      await record({
        caseId: result.caseId,
        kind: "case",
        status: result.status,
        cleanup: result.cleanup,
        durationMs: result.durationMs,
        evidence: result.evidence,
      });
    }
    void shared;

    // 4. CONTRACT, one per served tool, four at a time.
    const covered = new Set(opts.selected.flatMap((c) => c.covers));
    const queue = [...served];
    const contractStarted = Date.now();
    await Promise.all(
      Array.from({ length: Math.min(PROBE_CONCURRENCY, Math.max(served.length, 1)) }, async () => {
        for (;;) {
          const tool = queue.shift();
          if (!tool) return;
          const started = Date.now();
          const outcome = await checkContract(contractSubjectFor(tool), async (name) => {
            const result = await client.callTool(name, {});
            return { content: result.content, isError: result.isError };
          });
          await record({
            caseId: `contract:${tool.name}`,
            kind: "contract",
            status: outcome.status,
            cleanup: "none_needed",
            // REAL, because the first baseline recorded zero here and so
            // could not say which half of nine minutes was the probes.
            durationMs: Date.now() - started,
            evidence: [`steps: ${outcome.steps.join(", ")}`, ...outcome.evidence],
          });
        }
      })
    );
    const contractMs = Date.now() - contractStarted;

    // 5. UNCOVERED, one per served tool no case exercises. A run with any of
    // these is not fully green, which is the point: the honest first number
    // is every tool uncovered.
    const uncoveredStarted = Date.now();
    for (const tool of served) {
      if (covered.has(tool.name)) continue;
      await record({
        caseId: `uncovered:${tool.name}`,
        kind: "uncovered",
        status: "uncovered",
        cleanup: "none_needed",
        durationMs: 0,
        evidence: ["no registered case declares this tool in its covers"],
      });
    }

    // Where the wall clock went, as a row rather than as a log line nobody
    // will have kept. A run that is slow and cannot say why gets optimised
    // by guesswork.
    await record({
      caseId: "timing",
      kind: "case",
      status: "pass",
      cleanup: "none_needed",
      durationMs: contractMs,
      evidence: [
        `contract probes: ${served.length} tools in ${contractMs} ms at concurrency ${PROBE_CONCURRENCY}`,
        `uncovered rows: ${Date.now() - uncoveredStarted} ms`,
      ],
    });

    await finishRun(db, runId, { status: "finished", totals, toolsServed: served.length });
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * What a case declares but this run cannot supply. Exported so the rule can
 * be tested directly: a case with an unmapped role must SKIP, and never fall
 * back to whatever account happens to be default.
 */
export function missingMappingsFor(
  testCase: { accounts: AccountRole[]; fixtures?: FixtureKey[] },
  fixtures: ReturnType<typeof parseFixtureMap>
): string[] {
  return fixtures.missingFor({ accounts: testCase.accounts, fixtures: testCase.fixtures });
}

/**
 * Plugins this machine and this identity cannot actually exercise, with the
 * reason in words.
 *
 * Two different facts, both about the ENVIRONMENT rather than the product:
 * the plugin has no checkout here, or the identity running the suite has
 * never connected that plugin's service. Either way its tools are in the
 * registry, so they are served, so a case calling one fails on something
 * nobody can fix by reading the code.
 *
 * Failing to read the connections is NOT treated as "not connected": that
 * would turn a database hiccup into a run that skipped half its cases and
 * called it environment. It reports nothing blocked and lets the cases run
 * and fail honestly.
 */
export async function unusablePlugins(
  db: Database,
  userId: string,
  notInstalled: readonly string[]
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const slug of notInstalled) out.set(slug, "the plugin is not installed on this machine");

  let connected: Set<string>;
  try {
    const rows = await db
      .select({ service: serviceConnections.service })
      .from(serviceConnections)
      .where(eq(serviceConnections.userId, userId));
    connected = new Set(rows.map((r) => r.service));
  } catch {
    return out;
  }

  for (const [slug, service] of Object.entries(PLUGIN_SERVICE_MAP)) {
    if (out.has(slug)) continue;
    if (!connected.has(service)) {
      out.set(slug, `this identity has no ${service} connection on this database`);
    }
  }
  return out;
}

/** The unusable plugins a case's covered tools belong to. */
export function pluginsBlocking(
  testCase: { covers: readonly string[] },
  unusable: ReadonlyMap<string, string>
): [string, string][] {
  const slugs = new Set(
    testCase.covers.filter((t) => t.includes("__")).map((t) => t.split("__", 1)[0])
  );
  return [...slugs]
    .filter((slug) => unusable.has(slug))
    .map((slug) => [slug, unusable.get(slug)!] as [string, string]);
}

/**
 * What a case covers that this run's `tools/list` does not carry.
 *
 * Separate from `missingMappingsFor` because the remedy is different: an
 * unmapped role is a configuration gap, an unserved tool is a registry gap
 * on whichever database this gateway is pointed at. Both skip, and both say
 * which.
 *
 * A case covering nothing is unaffected, which is what lets the cases about
 * the gateway itself run anywhere.
 */
export function unservedToolsFor(
  testCase: { covers: readonly string[] },
  served: ReadonlySet<string>
): string[] {
  return testCase.covers.filter((tool) => !served.has(tool));
}

/**
 * Coverage checked in BOTH directions.
 *
 * Declaring a tool a case never called overstates what the suite proves.
 * Calling one it never declared leaves that tool reported as uncovered while
 * a case exercises it, which is the quieter of the two and the reason the
 * second half exists. An empty declaration is fine: a case about the gateway
 * itself exercises no tool.
 */
export function coverageMismatch(covers: readonly string[], called: readonly string[]): string[] {
  const declaredButUncalled = covers.filter((t) => !called.includes(t));
  const calledButUndeclared = [...new Set(called)].filter((t) => !covers.includes(t));
  return [
    declaredButUncalled.length ? `declares ${declaredButUncalled.join(", ")} but never called it` : "",
    calledButUndeclared.length ? `called ${calledButUndeclared.join(", ")} without declaring it in covers` : "",
  ].filter(Boolean);
}

/**
 * The half of a case's context that talks to the outside.
 *
 * `call` is where the ACCOUNT is injected and where the send guard sits. A
 * case names a role and never an address, and it cannot pass an `account`
 * argument of its own: that would be a case choosing whose mailbox to touch.
 */
export function makeContextParts(opts: {
  client: RunnerClient;
  fixtures: ReturnType<typeof parseFixtureMap>;
  called: string[];
  /** Only the three `ctx.gateway` questions need these, and both are
   * optional so the pure half of this context stays testable with neither a
   * database nor a plugin process. A case that asks without them is told so
   * rather than reading a made-up answer. */
  db?: Database;
  pool?: ConnectionPool;
}): ContextParts {
  const { client, fixtures, called } = opts;

  const needs = (what: string) => {
    throw new Error(`ctx.gateway.${what}: this run has no database or plugin pool`);
  };

  const lookups: GuardLookups = {
    async readDraft(draftId) {
      const result = await client.callTool("gws-mcp__gmail_read", { message_id: draftId });
      return parseHeaders(result);
    },
    async readMessage(messageId) {
      const result = await client.callTool("gws-mcp__gmail_read", { message_id: messageId });
      return parseHeaders(result);
    },
  };

  return {
    async call(tool, args, callOpts) {
      if ("account" in args) {
        throw new Error(`${tool}: a case may not pass account; declare a role and use { as }`);
      }
      const role = (callOpts?.as ?? "sender") as AccountRole;
      // A GATEWAY BUILT-IN TAKES NO ACCOUNT. `account` picks between a
      // user's connected accounts for a PLUGIN tool; a built-in has no such
      // notion, and handing one an argument its schema never declared is
      // both a rejection waiting to happen and an address in a call that
      // had no business carrying one. Built-ins are the unnamespaced names.
      const isPluginTool = tool.includes("__");
      const account = isPluginTool ? fixtures.account(role) : null;
      const withAccount = account ? { ...args, account } : { ...args };

      const verdict = await checkSend(tool, withAccount, {
        readerEmail: fixtures.account("reader"),
        lookups,
      });
      if (!verdict.ok) throw new Error(verdict.reason);

      called.push(tool);
      return client.callTool(tool, withAccount);
    },
    async rpc(method) {
      if (method !== "tools/list") {
        throw new Error(`ctx.rpc: only tools/list is available, got ${JSON.stringify(method)}`);
      }
      return { tools: await client.listTools() };
    },
    http: createHttpFetcher(loopbackBase(getEnv().GATEWAY_PORT)),
    gateway: {
      registrySurface: () =>
        opts.db && opts.pool ? registrySurface(opts.db, opts.pool) : needs("registrySurface"),
      classify: (names) => classifyTools(names),
      nonAdminView: () =>
        opts.db ? nonAdminView(opts.db, fixtures.user("nonAdmin") ?? undefined) : needs("nonAdminView"),
    },
    fixture(key: FixtureKey) {
      const value = fixtures.fixture(key);
      if (!value) throw new Error(`no fixture is mapped for ${key}`);
      return value;
    },
    from() {
      return {};
    },
    share() {},
  };
}

/** Headers out of a gmail_read result, for the send guard's two lookups. */
function parseHeaders(result: { content: { text?: string }[]; isError?: boolean }) {
  if (result.isError) return null;
  try {
    const parsed = JSON.parse(result.content.map((c) => c.text ?? "").join("")) as Record<string, unknown>;
    const pick = (...names: string[]) => {
      for (const name of names) {
        const value = parsed[name];
        if (typeof value === "string") return value;
      }
      return undefined;
    };
    return {
      to: pick("to", "To"),
      cc: pick("cc", "Cc"),
      bcc: pick("bcc", "Bcc"),
      subject: pick("subject", "Subject"),
      from: pick("from", "From"),
      replyTo: pick("reply_to", "replyTo", "Reply-To"),
    };
  } catch {
    return null;
  }
}

/**
 * The plugins to record a sha for, from the REGISTRY rather than a list in
 * this file.
 *
 * It was a hardcoded pair, which is the kind of list that is right until
 * someone installs a third plugin and the run quietly stops recording it.
 * A slug with no checkout still reports null, which is the honest answer and
 * is what a local gateway says about a plugin it does not have installed.
 */
export async function activePluginSlugs(db: Database): Promise<string[]> {
  try {
    const rows = await db
      .select({ slug: mcpServers.slug })
      .from(mcpServers)
      .where(eq(mcpServers.status, "active"));
    return rows.map((r) => r.slug).sort();
  } catch {
    return [];
  }
}

/** Read or write comes from the classifier the agent's approval gate uses,
 * which fails closed, or from a built-in's own declaration. */
export function contractSubjectFor(tool: {
  name: string;
  inputSchema?: Record<string, unknown>;
}): ContractSubject {
  const builtin = BUILT_IN_TOOLS.find((t) => t.definition.name === tool.name);
  return {
    name: tool.name,
    schema: tool.inputSchema,
    // A built-in has no registry row by design and is not missing one.
    registryEnabled: true,
    isRead: builtin ? builtin.approval === "read" : !classifyWrite(tool.name),
  };
}
