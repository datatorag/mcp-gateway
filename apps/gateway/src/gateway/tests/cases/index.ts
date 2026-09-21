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
import { f1ApprovalBoundary } from "./f1-approval-boundary";
import { f2UnapprovedScopes } from "./f2-unapproved-scopes";
import { f7ApiKeyRefused } from "./f7-api-key-refused";
import { g1ErrorShape } from "./g1-error-shape";
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
 * C11 IS NOT HERE AND THAT IS ON PURPOSE. It sits in the sheet's read
 * section but it creates and deletes a real Jira issue, with a
 * whole-board baseline either side of the delete. It is a round trip
 * wearing a C number, so it goes with the round trips in 4c rather than
 * making the read batch a batch that writes.
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
  f1ApprovalBoundary,
  f2UnapprovedScopes,
  f7ApiKeyRefused,
  g1ErrorShape,
  r1FrontDoor,
  r2AdminOnly,
];
