import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Database, TestRunScope, TestRunTotals } from "@datatorag-mcp/db";
import { getEnv } from "@datatorag-mcp/config";
import { createMcpServer, BUILT_IN_TOOLS } from "../mcp-server";
import type { ConnectionPool } from "../pool";
import { classifyWrite } from "../playground/tools";
import { checkContract, type ContractSubject } from "./contract";
import { createHttpFetcher, loopbackBase } from "./http";
import { CASES } from "./cases";
import { orderByNeeds } from "./runner";
import { finishRun, recordResult, startRun } from "./store";
import { readPluginShas } from "./plugin-sha";
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
const PLUGIN_SLUGS = ["gws-mcp", "atlassian-mcp"] as const;

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
    pluginShas: readPluginShas(PLUGINS_DIR, PLUGIN_SLUGS),
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
  const record = async (row: Parameters<typeof recordResult>[2]) => {
    await recordResult(db, runId, row);
    if (row.status === "pass") totals.pass += 1;
    else if (row.status === "fail") totals.fail += 1;
    else if (row.status === "skip") totals.skip += 1;
    else totals.uncovered += 1;
  };

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

    // 3. EXECUTE. No case is registered yet (SCRUM-303 phase 2 shipped the
    // engine alone), so this is empty today and the run is still worth
    // starting: the contract and uncovered steps below are the whole of the
    // first honest baseline.
    void order;

    // 4. CONTRACT, one per served tool.
    const covered = new Set(opts.selected.flatMap((c) => c.covers));
    for (const tool of served) {
      const subject = contractSubjectFor(tool);
      const outcome = await checkContract(subject, async (name) => {
        const result = await client.callTool(name, {});
        return { content: result.content, isError: result.isError };
      });
      await record({
        caseId: `contract:${tool.name}`,
        kind: "contract",
        status: outcome.status,
        cleanup: "none_needed",
        durationMs: 0,
        evidence: [`steps: ${outcome.steps.join(", ")}`, ...outcome.evidence],
      });
    }

    // 5. UNCOVERED, one per served tool no case exercises. A run with any of
    // these is not fully green, which is the point: the honest first number
    // is every tool uncovered.
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

    await finishRun(db, runId, { status: "finished", totals, toolsServed: served.length });
  } finally {
    await client.close().catch(() => {});
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
