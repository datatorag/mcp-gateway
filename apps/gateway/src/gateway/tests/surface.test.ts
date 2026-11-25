/**
 * SCRUM-511: the three-way comparison (A4) asks each active plugin what it
 * serves. A plugin whose connector the vendor serves now is not started and
 * none of its registry rows is listed, so asking it could only fail, and its
 * rows could only read as drift. It is left out; every other active plugin
 * is still asked.
 */
import { describe, expect, it, vi } from "vitest";
import { registrySurface } from "./surface";
import { supersededPlugin } from "../upstream-tools";

type Server = { slug: string; id: string; containerPort: number; githubRepoUrl: string | null };

/** A database that answers the active servers first, then each server's
 * enabled tool rows in the order the servers are asked. */
function dbWith(servers: Server[], rows: Record<string, string[]>) {
  const asked: string[] = [];
  let first = true;
  const db = {
    select: () => ({
      from: () => ({
        where: async () => {
          if (first) {
            first = false;
            return servers;
          }
          const server = servers.filter((s) => !supersededPlugin(s.slug))[asked.length];
          asked.push(server?.slug ?? "unexpected");
          return (rows[server?.slug ?? ""] ?? []).map((name) => ({ name }));
        },
      }),
    }),
  };
  return { db: db as never, asked };
}

const server = (slug: string, port: number): Server => ({ slug, id: `id-${slug}`, containerPort: port, githubRepoUrl: null });

describe("registrySurface", () => {
  it("leaves out a plugin the vendor's own server has superseded, and asks every other one", async () => {
    expect(supersededPlugin("posthog-mcp")).toBe(true);
    expect(supersededPlugin("slack-mcp")).toBe(false);

    const { db, asked } = dbWith([server("slack-mcp", 40001), server("posthog-mcp", 40002)], {
      "slack-mcp": ["slack-mcp__slack_channels_list"],
      "posthog-mcp": ["posthog-mcp__posthog_project_get"],
    });
    const client = { listTools: vi.fn().mockResolvedValue({ tools: [{ name: "slack_channels_list" }] }) };
    const pool = { acquire: vi.fn().mockResolvedValue(client), release: vi.fn() };

    const { plugins } = await registrySurface(db, pool as never);

    expect(plugins.map((p) => p.slug)).toEqual(["slack-mcp"]);
    expect(plugins[0]).toMatchObject({ live: ["slack_channels_list"], registry: ["slack-mcp__slack_channels_list"] });
    // The superseded plugin's process is never asked, and its rows never read.
    expect(pool.acquire).toHaveBeenCalledTimes(1);
    expect(pool.acquire.mock.calls[0][0]).toBe("id-slack-mcp");
    expect(asked).toEqual(["slack-mcp"]);
  });

  it("still reports a plugin that could not be asked, by the name of the failure", async () => {
    const { db } = dbWith([server("slack-mcp", 40001)], { "slack-mcp": ["slack-mcp__slack_channels_list"] });
    const pool = { acquire: vi.fn().mockRejectedValue(new TypeError("connect refused at an internal address")), release: vi.fn() };
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { plugins } = await registrySurface(db, pool as never);
    errors.mockRestore();
    expect(plugins).toEqual([{ slug: "slack-mcp", live: null, registry: ["slack-mcp__slack_channels_list"], error: "TypeError" }]);
  });
});
