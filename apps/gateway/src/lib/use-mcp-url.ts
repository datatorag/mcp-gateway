"use client";

import { useEffect, useState } from "react";
import { DEFAULT_MCP_URL } from "./mcp-clients";

/** The MCP server URL for this origin. Seeded with production's, so a
 * prerendered page ships it in its HTML, and corrected after mount for any
 * other origin (a local build, a preview). */
export function useMcpUrl(): string {
  const [mcpUrl, setMcpUrl] = useState(DEFAULT_MCP_URL);
  useEffect(() => {
    setMcpUrl(`${window.location.origin}/mcp`);
  }, []);
  return mcpUrl;
}
