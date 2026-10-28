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
 * connected account (it is the identity case `R2` lists as).
 *
 * `notion` and `notionSecond` (SCRUM-366) name two Notion WORKSPACES, and
 * what is mapped for each is the workspace id, not an email: one email can
 * hold both workspaces, and the gateway refuses an email that matches two
 * accounts rather than picking one. */
export const ACCOUNT_ROLES = ["sender", "reader", "atlassian", "nonAdmin", "notion", "notionSecond"] as const;
export type AccountRole = (typeof ACCOUNT_ROLES)[number];

/** Named by KEY, never by id, for the same reason. */
export const FIXTURE_KEYS = [
  "sheet",
  "scratchTab",
  "folder",
  "doc",
  "deck",
  "calendarEvent",
  /** A tasklist made for this suite. The connector can create a tasklist
   * and cannot delete one, so cases never make their own: residue would be
   * permanent and would land in whatever list a real person uses. */
  "tasklist",
  /** The Jira project new issues are created in, and the issue carrying the
   * standing attachment. Keys rather than literals: the project and the
   * issue belong to our tenant and this repo is public. */
  "jiraProject",
  "jiraAttachmentIssue",
  /** The Confluence space new pages are created in, and the page carrying
   * the standing attachment. The attachment's own filename is NEVER a key
   * or a literal: it was uploaded by hand and contains a character that
   * does not survive retyping, so CF4 derives it with a CQL search. */
  "confluenceSpace",
  "confluenceAttachmentPage",
  "querySheet",
  /** The TAB inside `querySheet` that C12 runs over. A key rather than a
   * literal in a case, for the same reason every id is: this repo is public
   * and that tab belongs to a private sheet. */
  "queryTab",
  /** A message in the reader mailbox carrying one attachment over 5 MiB,
   * sent by hand, and that attachment's md5 as computed from the original
   * file before it was sent. The md5 is a key because it is the second,
   * independent source D15 compares Drive against: at that size the
   * attachment cannot be fetched back through the connector, whose
   * responses stop at 900 KB. */
  "attachmentMessage",
  "attachmentMd5",
  /** A message in the reader mailbox whose subject carries the smoke prefix
   * and which is never trashed: the file the attachment steps move. A
   * search for the prefix is not enough, because every message the runner
   * sends is trashed by the case that sent it, so the search can come back
   * empty with nothing wrong. Pinned, as the attachment message is. */
  "smokeMessage",
  /** A page in the `notion` workspace, shared with the DataToRAG
   * connection, with a title, some body text and at least one property;
   * the data source (a database's table) that page's workspace holds for
   * the query and schema steps, with two rows or more so a page of one has
   * more after it; and that data source's database. The database is a key
   * of its own rather than derived from the data source, so the schema step
   * checks two independently configured ids against each other. */
  "notionPage",
  "notionDataSource",
  "notionDatabase",
  /** A page in the `notionSecond` workspace, shared with that workspace's
   * connection, for the step proving each workspace sees only its own. */
  "notionSecondPage",
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
  /** `route: "workspace-name"` sends the mapped workspace's NAME as the
   * account instead of its id, the way a user would type it. Only for a
   * workspace role; the name is read from the gateway's own
   * `list_connected_accounts` for the mapped id, never chosen by the case. */
  call(
    tool: string,
    args: Record<string, unknown>,
    opts?: { as?: AccountRole; route?: "workspace-name" }
  ): Promise<ToolResult>;
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
  /** Tools a case calls ONLY when there is something to set up or to clean
   * up. Allowed to be called, never required to be, and never counted as
   * coverage: a delete that runs only when a send failed to consume the
   * draft proves nothing about the delete on a run where it did not run.
   * Declaring such a tool in `covers` failed D11 and E15 on every run in
   * which the product worked, because the cleanup had nothing to do, and DR7
   * on every run after its first, because its standing fixture was already
   * there to reuse. */
  cleanupCalls?: string[];
  accounts: AccountRole[];
  /** The declared accounts must be DIFFERENT accounts. For a case whose
   * claim is a comparison between two accounts, which one account mapped
   * to both roles cannot make: the case skips and says so rather than
   * failing on the configuration or passing on a comparison of a mailbox
   * with itself. */
  distinctAccounts?: true;
  fixtures?: FixtureKey[];
  /** Case ids whose shared output this one rides on. */
  needs?: string[];
  timeoutMs?: number;
  /**
   * A lock name. Cases sharing one never overlap.
   *
   * IGNORED FOR A CASE IN A SCENARIO, which gets the scenario's own lock so
   * a lifecycle's steps cannot interleave. Letting a case keep its own lock
   * there was a hazard rather than a courtesy: the sheets writers shared a
   * `scratch-tab` lock and would have serialised against each other while
   * running concurrently with the step deleting the spreadsheet they were
   * all writing to. This field is therefore only for cases outside a
   * scenario, and there are none left once the regroup finishes.
   */
  serial?: string;
  /**
   * Further lock names, held together with `serial` for the whole case.
   * Set by the runner, never by a case: a lock derived from what a case does
   * cannot be forgotten. Today that is the file-transfer lock (SCRUM-428),
   * which holds across scenarios where the scenario lock cannot.
   */
  locks?: readonly string[];
  /**
   * The case hands a file reference to a tool that also runs without one,
   * such as an email whose attachments name files (SCRUM-437). A fact about
   * what the case does, not a lock: the runner reads it, with `covers`, to
   * decide whether the case holds the file-transfer lock. A tool that only
   * ever takes a file needs no flag, because `covers` already says so.
   */
  crossesFiles?: true;
  run(ctx: CaseContext): Promise<void>;
}
