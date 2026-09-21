/**
 * What a test case IS (SCRUM-303).
 *
 * A case is a TypeScript module, not a row and not a prose instruction. Its
 * id and description are read from the module, so a case cannot exist in
 * one place and be missing from another, and there is no cases table to
 * drift from the code.
 *
 * A case is a STEP of a scenario. Which scenario, and in what order, is
 * declared once in `scenarios.ts` rather than as a field here: put it on
 * the case and the lifecycle can be reordered by editing a file nobody
 * opened, and no one place reads as the flow.
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
  /** The TAB inside `querySheet` that C12 runs over. A key rather than a
   * literal in a case, for the same reason every id is: this repo is public
   * and that tab belongs to a private sheet. */
  "queryTab",
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
  /** The configured address for a role, for the rare case that needs one in
   * a field rather than as the acting account: a draft has to carry a
   * recipient. Resolved from config like everything else, so a case in this
   * public repo still never contains an address, and the send guard still
   * decides independently whether that recipient is allowed. */
  address(role: AccountRole): string;
  /**
   * Trash a message THIS RUN SENT, and prove it is gone.
   *
   * The only cleanup that reaches a mailbox, and the only `gws_run` write
   * the runner may make. It refuses any message whose subject does not
   * carry this case's own stamp and the smoke prefix, so it cannot reach
   * mail this run did not create even if a case hands it the wrong id.
   *
   * Returns true when the message is gone, false when it could not be
   * trashed — a case records the id as residue rather than failing, because
   * an uncleaned message is a fact to report, not a reason to call the
   * feature broken.
   */
  trashOwnMessage(messageId: string, opts?: { as?: AccountRole }): Promise<boolean>;
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
