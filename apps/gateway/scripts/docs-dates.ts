/** Writes content/docs-dates.json: each docs page's slug with the day its
 * file last changed, from git. Run it from apps/gateway after editing a docs
 * page: `pnpm docs:dates`. A page with changes that are not committed gets
 * today's date. See src/lib/docs-dates.ts for why the dates are checked in. */
import { writeFileSync } from "node:fs";
import path from "node:path";
import { DOCS_DATES_FILE, docsLastChanged, gitHistoryAvailable } from "../src/lib/docs-dates";

const cwd = process.cwd();

if (!gitHistoryAvailable(cwd)) {
  console.error("docs:dates needs a git checkout with its full history (not a shallow clone). Nothing written.");
  process.exit(1);
}

const dates = docsLastChanged(cwd);
const unknown = Object.entries(dates).filter(([, date]) => date === null).map(([slug]) => slug);
if (unknown.length > 0) {
  console.error(`git has no date for: ${unknown.join(", ")}. Nothing written.`);
  process.exit(1);
}

writeFileSync(path.join(cwd, DOCS_DATES_FILE), `${JSON.stringify(dates, null, 2)}\n`);
console.log(`Wrote ${DOCS_DATES_FILE}: ${Object.keys(dates).length} pages.`);
