import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Each installed plugin's commit, read from its checkout's git metadata by
 * READING FILES (SCRUM-303).
 *
 * Deliberately not `git rev-parse`. Spawning a process per plugin on every
 * run, inside the container, to learn a 40-character string that is sitting
 * in a file is cost and a failure mode for nothing. It also keeps this
 * callable from a test with a fixture directory, which a spawn does not.
 *
 * Anything unreadable gives null, and the diff then says "sha unknown".
 * A guess here would be worse than a gap: the whole point of recording shas
 * is to answer "what changed between these two runs", and a wrong sha
 * answers it confidently and incorrectly.
 */

/** A detached HEAD holds the sha directly; otherwise it names a ref. */
export function readGitSha(repoDir: string): string | null {
  let head: string;
  try {
    head = readFileSync(join(repoDir, ".git", "HEAD"), "utf8").trim();
  } catch {
    return null;
  }

  if (!head.startsWith("ref:")) return looksLikeSha(head) ? head : null;

  const ref = head.slice(4).trim();
  if (!ref || ref.includes("..")) return null;

  // The loose ref file, if the ref has not been packed.
  try {
    const loose = readFileSync(join(repoDir, ".git", ref), "utf8").trim();
    if (looksLikeSha(loose)) return loose;
  } catch {
    // fall through to packed-refs
  }

  // packed-refs: `<sha> <ref>` per line, with `#` comments and `^` peel
  // lines for annotated tags, which must not be read as the ref's own sha.
  try {
    const packed = readFileSync(join(repoDir, ".git", "packed-refs"), "utf8");
    for (const line of packed.split("\n")) {
      // The `^` skip is a backstop rather than load-bearing: a peel line
      // carries no ref name, so the name comparison below already rejects
      // it, and deleting this turns nothing red. It stays because it says
      // what a `^` line IS, which the comparison does not.
      if (!line || line.startsWith("#") || line.startsWith("^")) continue;
      const [sha, name] = line.trim().split(/\s+/, 2);
      if (name === ref && looksLikeSha(sha)) return sha;
    }
  } catch {
    return null;
  }
  return null;
}

function looksLikeSha(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value);
}

/** `{slug: sha|null}` for the plugins named, read from `<pluginsDir>/<slug>`. */
export function readPluginShas(
  pluginsDir: string,
  slugs: readonly string[]
): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const slug of slugs) out[slug] = readGitSha(join(pluginsDir, slug));
  return out;
}
