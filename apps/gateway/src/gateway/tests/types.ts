/**
 * What a test case IS (SCRUM-303).
 *
 * A case is a TypeScript module, not a row and not a prose instruction. Its
 * id, tier and description are read from the module, so a case cannot exist
 * in one place and be missing from another, and there is no cases table to
 * drift from the code.
 *
 * A case passes by returning and fails by throwing. There is no model
 * anywhere in this path: the assertions are ordinary helpers whose thrown
 * message becomes the evidence.
 */

/** Named by ROLE, never by address. A case in this public repo cannot
 * contain a mailbox, and `nonAdmin` names a USER of ours rather than a
 * connected account (it is the identity case `R2` lists as). */
export const ACCOUNT_ROLES = ["sender", "reader", "atlassian", "nonAdmin"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Named by KEY, never by id, for the same reason. */
export const FIXTURE_KEYS = [
  "sheet",
  "scratchTab",
  "folder",
  "doc",
  "deck",
  "calendarEvent",
  "querySheet",
] as const;
export type FixtureKey = (typeof FIXTURE_KEYS)[number];

import type { NonAdminView, PluginSurface } from "./surface";

/**
 * Three questions a case asks of the gateway it is running INSIDE.
 *
 * On the context rather than imported by the case directly, so a case stays
 * drivable with no database and no plugin process. See `surface.ts` for why
 * these are in-process calls and not loopback fetches.
 */
export interface GatewaySurface {
  registrySurface(): Promise<{ plugins: PluginSurface[] }>;
  classify(names: readonly string[]): Record<string, boolean>;
  nonAdminView(): Promise<NonAdminView>;
}

export type ToolResult = {
  content: { type: string; text?: string }[];
  isError?: boolean;
  structuredContent?: unknown;
};

export interface CaseContext {
  runId: string;
  /** Unique per run and case. Everything a case creates carries it, so the
   * next run can find what an interrupted one left behind. */
  stamp: string;
  call(tool: string, args: Record<string, unknown>, opts?: { as?: AccountRole }): Promise<ToolResult>;
  rpc(method: string, params?: Record<string, unknown>): Promise<unknown>;
  /** Loopback only, path only, and NO credential. See `http.ts`. A surface
   * behind the admin guard is therefore unreachable here by construction;
   * ask `ctx.gateway` for those. */
  http(path: string, init?: RequestInit): Promise<Response>;
  gateway: GatewaySurface;
  fixture(key: FixtureKey): string;
  /** What a case named in `needs` shared. */
  from(caseId: string): Record<string, unknown>;
  share(values: Record<string, unknown>): void;
  /** Register an undo BEFORE or immediately after the step that creates
   * something. Undos run in reverse order in a `finally`, whether the body
   * passed, threw or timed out. */
  defer(label: string, undo: () => Promise<void>): void;
  evidence(line: string): void;
  /** The one way to wait. Never a sleep: a poll with a stated budget. */
  until<T>(
    what: string,
    probe: () => Promise<T | undefined>,
    opts?: { everyMs?: number; forMs?: number }
  ): Promise<T>;
}

export interface TestCase {
  /** The smoke row it descends from (`D15`), or a runner-native id (`R1`). */
  id: string;
  title: string;
  tier: 1 | 2;
  /** Namespaced tool names this case exercises. A DECLARATION: the runner
   * also records what was actually called and fails a case that declares a
   * tool it never called, so this cannot quietly overstate coverage. */
  covers: string[];
  accounts: AccountRole[];
  fixtures?: FixtureKey[];
  /** Case ids whose shared output this one rides on. */
  needs?: string[];
  timeoutMs?: number;
  /** A lock name. Cases sharing one never overlap. */
  serial?: string;
  run(ctx: CaseContext): Promise<void>;
}
