import type { TestCase } from "../types";
import { a1Health } from "./a1-health";
import { a2Handshake } from "./a2-handshake";
import { a3ToolsListed } from "./a3-tools-listed";
import { a4ThreeWay } from "./a4-three-way";
import { a5Analytics } from "./a5-analytics";
import { b1StoredToken } from "./b1-stored-token";
import { b2TwoAccounts } from "./b2-two-accounts";
import { c1SheetsRead } from "./c1-sheets-read";
import { c2GmailSearch } from "./c2-gmail-search";
import { c3CalendarRead } from "./c3-calendar-read";
import { c4DriveSearch } from "./c4-drive-search";
import { c5DocsRead } from "./c5-docs-read";
import { c6SlidesRead } from "./c6-slides-read";
import { c7JiraSearch } from "./c7-jira-search";
import { c8ConfluenceSearch } from "./c8-confluence-search";
import { c9ContactsList } from "./c9-contacts-list";
import { c10TasksList } from "./c10-tasks-list";
import { c12SheetsQuery } from "./c12-sheets-query";
import { c13SkillsSurface } from "./c13-skills-surface";
import { d1SheetsAppend } from "./d1-sheets-append";
import { d2SheetsUpdate } from "./d2-sheets-update";
import { d3GmailDraft } from "./d3-gmail-draft";
import { d4DocsRoundTrip } from "./d4-docs-roundtrip";
import { d5CalendarRoundTrip } from "./d5-calendar-roundtrip";
import { d6SlidesRoundTrip } from "./d6-slides-roundtrip";
import { d7SheetsTab } from "./d7-sheets-tab";
import { d9DriveRoundTrip } from "./d9-drive-roundtrip";
import { e1GmailLabel } from "./e1-gmail-label";
import { e3SheetsText } from "./e3-sheets-text";
import { e4SheetsCoercion } from "./e4-sheets-coercion";
import { c11JiraRoundTrip } from "./c11-jira-roundtrip";
import { d14SheetsFormat } from "./d14-sheets-format";
import { d15AttachmentBytes } from "./d15-attachment-bytes";
import { e2GmailFilters } from "./e2-gmail-filters";
import { e5Annotations } from "./e5-annotations";
import { e8ServedSchema } from "./e8-served-schema";
import { e9DocsPartial } from "./e9-docs-partial";
import { e10DocsReplace } from "./e10-docs-replace";
import { e11SheetsBadRange } from "./e11-sheets-bad-range";
import { e16BatchLabel } from "./e16-batch-label";
import { e17MultiRange } from "./e17-multi-range";
import { d10MailArrives } from "./d10-mail-arrives";
import { d11DraftSent } from "./d11-draft-sent";
import { d12ReplyThreads } from "./d12-reply-threads";
import { d13ForwardCarries } from "./d13-forward-carries";
import { e13SignatureApplied } from "./e13-signature-applied";
import { e14SignatureSuppressed } from "./e14-signature-suppressed";
import { e15DraftSignature } from "./e15-draft-signature";
import { f1ApprovalBoundary } from "./f1-approval-boundary";
import { f2UnapprovedScopes } from "./f2-unapproved-scopes";
import { f7ApiKeyRefused } from "./f7-api-key-refused";
import { g1ErrorShape } from "./g1-error-shape";
import { gw1ConnectedAccounts } from "./gw1-connected-accounts";
import { r1FrontDoor } from "./r1-front-door";
import { r2AdminOnly } from "./r2-admin-only";

/**
 * Every registered case (SCRUM-303).
 *
 * Batch 4a: the eleven that need no fixture mapping, plus the two the runner
 * has that the sheet never could. Batch 4b: the read path, one case per
 * service. A case is added by writing its module here and listing it;
 * `registry.test.ts` asserts the list and the directory agree, so a file
 * nobody listed fails rather than silently not running.
 *
 * Batch 4c, part one: the write round trips. Every one of them creates
 * something and removes it again in the same run, and every removal is
 * VERIFIED by a read or a listing rather than assumed from a success
 * response. Three carry a deviation from their smoke row, ruled by HQ on
 * 2026-09-20 and stated in the case's own text so the tab can be brought
 * into line: D3's recipient, D4 and D6's containment, D5's delete check.
 *
 * C11 IS A ROUND TRIP WEARING A C NUMBER. It sits in the sheet's read
 * section and creates and deletes a real Jira issue, with a whole-board
 * baseline either side, so it is here in 4c rather than in the read batch.
 *
 * Batch 4d is the MAIL, and it is last for a reason: it is the only batch
 * whose failure mode reaches a person. Every send goes to the reader
 * mailbox, which we own and can read, carries the smoke prefix and this
 * run's stamp, and is trashed by `ctx.trashOwnMessage` — which refuses any
 * message whose subject does not carry that stamp. What a run cannot trash
 * it reports as residue rather than leaving silent.
 *
 * NINE ROWS ARE DELIBERATELY NOT PORTED AT ALL (E6, E7, E12, F3, F4, F5,
 * F6, G2, H1). They need a browser, a human judgement or a third-party
 * console, so they stay with the agent rather than becoming cases that
 * quietly assert less than their row says.
 *
 * The cases carry the smoke sheet's ids on purpose. A ported case that
 * renamed itself would break every reference in three years of run logs.
 */
export const CASES: TestCase[] = [
  a1Health,
  a2Handshake,
  a3ToolsListed,
  a4ThreeWay,
  a5Analytics,
  b1StoredToken,
  b2TwoAccounts,
  c1SheetsRead,
  c2GmailSearch,
  c3CalendarRead,
  c4DriveSearch,
  c5DocsRead,
  c6SlidesRead,
  c7JiraSearch,
  c8ConfluenceSearch,
  c9ContactsList,
  c10TasksList,
  c12SheetsQuery,
  c13SkillsSurface,
  d1SheetsAppend,
  d2SheetsUpdate,
  d3GmailDraft,
  d4DocsRoundTrip,
  d5CalendarRoundTrip,
  d6SlidesRoundTrip,
  d7SheetsTab,
  d9DriveRoundTrip,
  e1GmailLabel,
  e3SheetsText,
  e4SheetsCoercion,
  c11JiraRoundTrip,
  d14SheetsFormat,
  d15AttachmentBytes,
  e2GmailFilters,
  e5Annotations,
  e8ServedSchema,
  e9DocsPartial,
  e10DocsReplace,
  e11SheetsBadRange,
  e16BatchLabel,
  e17MultiRange,
  d10MailArrives,
  d11DraftSent,
  d12ReplyThreads,
  d13ForwardCarries,
  e13SignatureApplied,
  e14SignatureSuppressed,
  e15DraftSignature,
  f1ApprovalBoundary,
  f2UnapprovedScopes,
  f7ApiKeyRefused,
  g1ErrorShape,
  gw1ConnectedAccounts,
  r1FrontDoor,
  r2AdminOnly,
];
