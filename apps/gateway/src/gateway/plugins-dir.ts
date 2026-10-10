import { join } from "node:path";
import { homedir } from "node:os";

/**
 * Where plugins are loaded from (SCRUM-390). `DATATORAG_PLUGINS_DIR` when it
 * is set, which only an image that carries the plugins does, in its
 * Dockerfile. Otherwise the folder under the home directory, which is what a
 * laptop uses.
 *
 * Read from the process environment and not from the config schema on
 * purpose: the value is a fact about the image, never a deploy setting. It
 * is not in the compose file, the parameter store or the database, so an
 * image rollback is the whole undo.
 *
 * In a file of its own so a page can ask where a plugin's files are without
 * importing the manager that starts processes.
 */
export function pluginsDirFrom(
  env: Record<string, string | undefined>,
  home: string
): { dir: string; fromImage: boolean } {
  const set = env.DATATORAG_PLUGINS_DIR?.trim();
  if (set) return { dir: set, fromImage: true };
  return { dir: join(home, ".datatorag", "plugins"), fromImage: false };
}

const resolvedPluginsDir = pluginsDirFrom(process.env, homedir());
export const PLUGINS_DIR = resolvedPluginsDir.dir;
/** True when the plugins are the image's own, built from the gateway's commit. */
export const PLUGINS_FROM_IMAGE = resolvedPluginsDir.fromImage;
