import { join } from "node:path";
import { readFile } from "node:fs/promises";

const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

/**
 * A plugin's README, as text, from the directory the plugins are loaded from
 * (SCRUM-390). One README per plugin, the one in the tree the image is built
 * from. Null when there is none: there is no second source, so a tool page
 * never shows text from somewhere other than the code that is running.
 */
export async function readPluginReadme(
  pluginsDir: string,
  slug: string
): Promise<string | null> {
  if (!SLUG_PATTERN.test(slug)) return null;
  try {
    return await readFile(join(pluginsDir, slug, "README.md"), "utf-8");
  } catch {
    return null;
  }
}
