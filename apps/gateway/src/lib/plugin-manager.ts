import { createDb } from "@datatorag-mcp/db";
import { PluginManager } from "@/gateway/plugin-manager";

const globalForPm = globalThis as unknown as {
  pluginManager: PluginManager | undefined;
};

export function getPluginManager(db?: ReturnType<typeof createDb>): PluginManager {
  if (!globalForPm.pluginManager) {
    if (!db) {
      throw new Error(
        "PluginManager not initialized: provide db on the first call"
      );
    }
    globalForPm.pluginManager = new PluginManager(db);
  }
  return globalForPm.pluginManager;
}
