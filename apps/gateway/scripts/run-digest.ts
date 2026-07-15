// Manual digest runner. Dry run (prints Block Kit JSON, posts nothing):
//   pnpm dlx tsx scripts/run-digest.ts --dry-run
// Live run (posts to the digest webhook):
//   pnpm dlx tsx scripts/run-digest.ts
// Requires a populated .env in apps/gateway or exported env vars.
import { createDb } from "@datatorag-mcp/db";
import { getEnv } from "@datatorag-mcp/config";
import { runDailyDigest } from "../src/gateway/digest.js";

const dryRun = process.argv.includes("--dry-run");
const db = createDb(getEnv().DATABASE_URL);
runDailyDigest(db, { dryRun })
  .then(() => {
    console.log(dryRun ? "[digest] dry run complete" : "[digest] posted");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[digest] failed", err);
    process.exit(1);
  });
