import type { TestCase } from "../types";
import { a1Health } from "./a1-health";
import { a2Handshake } from "./a2-handshake";
import { a3ToolsListed } from "./a3-tools-listed";
import { a4ThreeWay } from "./a4-three-way";
import { a5Analytics } from "./a5-analytics";
import { b1StoredToken } from "./b1-stored-token";
import { b2TwoAccounts } from "./b2-two-accounts";
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
 * has that the sheet never could. A case is added by writing its module here
 * and listing it; `registry.test.ts` asserts the list and the directory
 * agree, so a file nobody listed fails rather than silently not running.
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
  f1ApprovalBoundary,
  f2UnapprovedScopes,
  f7ApiKeyRefused,
  g1ErrorShape,
  r1FrontDoor,
  r2AdminOnly,
];
