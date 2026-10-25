/**
 * `node dist/tokens.js backfill | reencrypt | restore` (SCRUM-442).
 *
 * Its own entry, so it runs whenever it is started and never on an import:
 * a "was I started directly" check does not survive the bundler, which turns
 * `import.meta` into an empty object at this target and leaves the command
 * silently doing nothing.
 */
import { getDb } from "@/lib/db";
import { runTokenCommand } from "./token-crypto-commands";

runTokenCommand(getDb(), process.argv[2]).then(
  (code) => process.exit(code),
  (e: unknown) => {
    // The error's name alone: a driver message can quote a statement.
    console.error(`tokens: failed (${e instanceof Error ? e.name : "unknown"})`);
    process.exit(1);
  }
);
