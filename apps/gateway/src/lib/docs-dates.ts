import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";

/** The day each docs page last changed, read from git.
 *
 * The production image is built without `.git` and CI checks out one commit,
 * so nothing that serves a page can ask git. `pnpm docs:dates` asks it on a
 * developer's machine and writes the answers to `content/docs-dates.json`,
 * which is checked in and is what the loader reads. This module is the
 * asking: the script and the test that holds the manifest current both use
 * it. It starts a process, so nothing a page imports may import it. */

/** The manifest, relative to `apps/gateway`. */
export const DOCS_DATES_FILE = "content/docs-dates.json";
const DOCS_DIR = "content/docs";

function git(cwd: string, args: string[]): string | null {
  try {
    return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Whether git can say when a file last changed: there is a repository and
 * it holds its whole history. A shallow checkout answers every file with its
 * one commit's date, which is not when the file changed. */
export function gitHistoryAvailable(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-shallow-repository"]) === "false";
}

/** Today in this machine's time zone, `YYYY-MM-DD`: the zone git writes a
 * commit's day in. */
export function today(): string {
  const now = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${two(now.getMonth() + 1)}-${two(now.getDate())}`;
}

/** The day a file last changed: today when it holds changes that are not
 * committed (or is new), otherwise the day of the last commit that changed
 * it. Null when git knows nothing about the file. */
export function lastChanged(cwd: string, file: string): string | null {
  const uncommitted = git(cwd, ["status", "--porcelain", "--", file]);
  if (uncommitted === null) return null;
  if (uncommitted !== "") return today();
  return git(cwd, ["log", "-1", "--format=%cs", "--", file]) || null;
}

/** Every docs page's slug with the day it last changed, in slug order. */
export function docsLastChanged(cwd: string): Record<string, string | null> {
  const slugs = readdirSync(path.join(cwd, DOCS_DIR))
    .filter((name) => name.endsWith(".md"))
    .map((name) => name.slice(0, -".md".length))
    .sort();
  return Object.fromEntries(slugs.map((slug) => [slug, lastChanged(cwd, `${DOCS_DIR}/${slug}.md`)]));
}
