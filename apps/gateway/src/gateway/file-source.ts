import { eq } from "drizzle-orm";
import type { Database } from "@datatorag-mcp/db";
import { mcpServers } from "@datatorag-mcp/db";
import type { CrossFileOptions } from "./file-crossing";
import { resolveServiceToken } from "./service-token";
import { buildPluginServerUrl } from "./user-tools";

/**
 * How a referenced file's source is reached for ONE user: that user's token
 * for the service, and the address of the plugin that holds the file.
 *
 * One definition, used by every reader of a file reference (the plugin
 * crossing, the download link tool, the download route), so a file is read
 * the same way whoever asks. The user is bound here: nothing built from
 * this can ask for anyone else's token.
 */
export function sourceResolversFor(
  db: Database,
  userId: string
): Pick<CrossFileOptions, "resolveToken" | "resolvePluginUrl"> {
  return {
    // An account value naming more than one account resolves to nothing
    // here; no file source today has more than one account per email.
    resolveToken: async (service, account) => {
      const resolved = await resolveServiceToken(db, userId, service, account);
      // A failed refresh is still a source that cannot be read; it gets its
      // own words in a follow-up (SCRUM-190).
      return resolved && ("ambiguous" in resolved || "refreshFailed" in resolved) ? null : resolved;
    },
    resolvePluginUrl: async (slug) => {
      const [row] = await db
        .select({
          slug: mcpServers.slug,
          containerPort: mcpServers.containerPort,
          githubRepoUrl: mcpServers.githubRepoUrl,
        })
        .from(mcpServers)
        .where(eq(mcpServers.slug, slug))
        .limit(1);
      return row ? buildPluginServerUrl(row) : null;
    },
  };
}
