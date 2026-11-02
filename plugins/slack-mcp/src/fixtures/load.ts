/* Test support, excluded from the build (tsconfig.json). */
import { readFileSync } from "node:fs";

/** One Slack Web API answer body, from a `.json` file beside this one.
 *
 * Nothing here was recorded from a workspace. Each file is written from the
 * method's page in Slack's Web API reference (the documented example
 * response), reduced to the fields the tools read, with every id, name and
 * address replaced by a test value (`C000TEST1`, `U000TEST1`, example.test). */
export function documented(name: string): any {
  return JSON.parse(readFileSync(new URL(`./${name}.json`, import.meta.url), "utf8"));
}
