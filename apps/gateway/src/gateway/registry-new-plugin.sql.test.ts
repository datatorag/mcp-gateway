import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { sql } from "drizzle-orm";
import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import {
  getTestDb,
  stopTestDb,
  insertTestUser,
  isDockerAvailable,
} from "@/test-utils/db";

// A new plugin's registry pair (SCRUM-366), RUN on a throwaway Postgres.
//
// The generator (scripts/registry-diff.mjs) and the file check have text-level
// tests only; this is the proof that the SQL they write does what the files
// say against the real schema (drizzle migrations), with real jsonb md5s:
// the forward inserts the mcp_servers row on the lowest free port from 40000
// and the six notion-mcp tools, the rollback removes exactly those, and every
// guard refuses and changes nothing when the rows are not what the file
// expects. Every file runs AS registry_writer, the role created from
// registry/roles/registry-writer.sql, so the grants are proven sufficient too.
//
// postgres.js refuses a raw BEGIN on its pool, so each file's BEGIN/COMMIT is
// stripped and its body run inside db.transaction; the test asserts the file
// does carry them.
//
// Docker-optional, like route.liveness.test.ts: gated on isDockerAvailable(),
// and getTestDb() is called only inside the gated block.
const dockerAvailable = isDockerAvailable();

const REPO_ROOT = path.resolve(__dirname, "../../../..");
// The scripts are plain .mjs outside the gateway's tsconfig; imported by a
// computed URL so the typecheck does not follow them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const load = (rel: string): Promise<any> =>
  import(/* @vite-ignore */ pathToFileURL(path.join(REPO_ROOT, rel)).href);
const readJson = (rel: string) =>
  JSON.parse(readFileSync(path.join(REPO_ROOT, rel), "utf8"));

const SLUG = "notion-mcp";
const FROM = "0".repeat(40);
const TO = "1".repeat(40);

/** The file's statements between its own BEGIN and COMMIT. A registry file
 * ends at its COMMIT; the role file has its check queries after it. */
function bodyOf(file: string, { endsAtCommit = true } = {}): string {
  expect(file.match(/^BEGIN;$/gm)).toHaveLength(1);
  expect(file.match(/^COMMIT;$/gm)).toHaveLength(1);
  const start = file.indexOf("\nBEGIN;\n") + "\nBEGIN;\n".length;
  const end = file.indexOf("\nCOMMIT;\n") + 1;
  if (endsAtCommit) expect(file.slice(end)).toBe("COMMIT;\n");
  return file.slice(start, end);
}

/** The message Postgres raised, through drizzle's wrapper if there is one. */
function pgMessage(err: unknown): string {
  let e = err as { message?: string; cause?: unknown } | undefined;
  while (e?.cause) e = e.cause as typeof e;
  return String(e?.message ?? err);
}

describe.skipIf(!dockerAvailable)("a new plugin's registry pair, on real Postgres", () => {
  let db: Database;
  let forward: string;
  let rollback: string;
  let toolNames: string[];

  /** Runs a registry file the way the workflow does: one transaction, as the role. */
  const runAsRole = (file: string) =>
    db.transaction(async (tx) => {
      await tx.execute(sql.raw("SET LOCAL ROLE registry_writer"));
      await tx.execute(sql.raw(bodyOf(file)));
    });

  const refusal = async (file: string) => {
    try {
      await runAsRole(file);
    } catch (err) {
      return pgMessage(err);
    }
    throw new Error("the file ran; it was expected to refuse");
  };

  /** Everything the files could touch, in a comparable form. */
  async function snapshot() {
    const servers = await db.execute(
      sql.raw(
        "SELECT id, slug, name, description, github_repo_url, github_repo_owner, github_repo_name, license_spdx, manifest_json::text AS manifest, status, container_port, updated_at FROM mcp_servers ORDER BY slug"
      )
    );
    const tools = await db.execute(
      sql.raw(
        "SELECT t.id, s.slug, t.name, t.namespaced_name, t.description, t.input_schema_json::text AS schema, t.read_only_hint, t.enabled, t.updated_at FROM tools t JOIN mcp_servers s ON s.id = t.mcp_server_id ORDER BY t.namespaced_name"
      )
    );
    const envVars = await db.execute(sql.raw("SELECT id, mcp_server_id, key FROM mcp_server_env_vars ORDER BY id"));
    const connections = await db.execute(sql.raw("SELECT id, mcp_server_id FROM plugin_connections ORDER BY id"));
    return {
      servers: [...servers],
      tools: [...tools],
      envVars: [...envVars],
      connections: [...connections],
    };
  }

  async function seed(ports: [number, number] = [40000, 40001]) {
    for (const table of ["plugin_connections", "mcp_server_env_vars", "tools", "mcp_servers"]) {
      await db.execute(sql.raw(`DELETE FROM ${table}`));
    }
    await db.execute(
      sql`INSERT INTO mcp_servers (slug, name, container_port, status, github_repo_url) VALUES ('gws-mcp', 'Google Workspace', ${ports[0]}, 'active', 'https://example.test/gws-mcp'), ('atlassian-mcp', 'Atlassian', ${ports[1]}, 'active', 'https://example.test/atlassian-mcp')`
    );
    await db.execute(
      sql.raw(
        `INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint) SELECT id, 'gmail_read', 'gws-mcp__gmail_read', 'Reads mail.', '{"type": "object"}'::jsonb, true FROM mcp_servers WHERE slug = 'gws-mcp'`
      )
    );
    await db.execute(
      sql.raw(
        `INSERT INTO tools (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint) SELECT id, 'jira_get_issue', 'atlassian-mcp__jira_get_issue', 'Reads an issue.', '{"type": "object"}'::jsonb, true FROM mcp_servers WHERE slug = 'atlassian-mcp'`
      )
    );
  }

  beforeAll(async () => {
    db = await getTestDb();

    // The role, from the file HQ applies, not from a copy of it.
    const role = readFileSync(path.join(REPO_ROOT, "registry/roles/registry-writer.sql"), "utf8");
    await db.transaction(async (tx) => {
      await tx.execute(sql.raw(bodyOf(role, { endsAtCommit: false })));
    });
    // The answers the role file's own checks expect, for the grants it now holds.
    const tableRights = await db.execute(
      sql.raw("SELECT table_name, privilege_type FROM information_schema.role_table_grants WHERE grantee = 'registry_writer' ORDER BY table_name, privilege_type")
    );
    expect([...tableRights].map((r) => `${r.table_name} ${r.privilege_type}`)).toEqual([
      "mcp_servers DELETE",
      "mcp_servers SELECT",
      "tools DELETE",
      "tools SELECT",
    ]);
    const writeColumns = await db.execute(
      sql.raw("SELECT table_name, privilege_type, column_name FROM information_schema.column_privileges WHERE grantee = 'registry_writer' AND (privilege_type IN ('INSERT', 'UPDATE') OR table_name IN ('mcp_server_env_vars', 'plugin_connections')) ORDER BY table_name, privilege_type, column_name")
    );
    // Sorted here, not by the database's collation, which orders "_" and "s" its own way.
    expect([...writeColumns].map((r) => `${r.table_name} ${r.privilege_type} ${r.column_name}`).sort()).toEqual([
      ...["container_port", "description", "github_repo_name", "github_repo_owner", "github_repo_url", "license_spdx", "manifest_json", "name", "slug", "status"].map((c) => `mcp_servers INSERT ${c}`),
      "mcp_server_env_vars SELECT mcp_server_id",
      "plugin_connections SELECT mcp_server_id",
      ...["description", "input_schema_json", "mcp_server_id", "name", "namespaced_name", "read_only_hint"].map((c) => `tools INSERT ${c}`),
      ...["description", "input_schema_json", "read_only_hint", "updated_at"].map((c) => `tools UPDATE ${c}`),
    ].sort());
    const otherTables = await db.execute(
      sql.raw("SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm') AND c.relname NOT IN ('tools', 'mcp_servers') AND (has_table_privilege('registry_writer', c.oid, 'SELECT') OR has_table_privilege('registry_writer', c.oid, 'INSERT') OR has_table_privilege('registry_writer', c.oid, 'UPDATE') OR has_table_privilege('registry_writer', c.oid, 'DELETE'))")
    );
    expect([...otherTables]).toEqual([]);

    // The pair, from the pure functions, for plugins/notion-mcp with an empty base.
    const diffMod = await load("scripts/registry-diff.mjs");
    const { toToolFile } = await load("scripts/plugin-tools.mjs");
    const { checkRegistryFile } = await load("scripts/registry-file-check.mjs");
    const { allTools } = await load("plugins/notion-mcp/src/tools/index.ts");
    // What the plugin serves is its tool array as JSON on the wire.
    const toolFile = toToolFile(JSON.parse(JSON.stringify(allTools)));
    toolNames = toolFile.tools.map((t: { name: string }) => t.name);
    const row = diffMod.serverRow(
      SLUG,
      readJson("plugins/notion-mcp/datatorag.json"),
      readJson("plugins/notion-mcp/package.json")
    );
    const files = diffMod.changeFiles(SLUG, FROM, TO, diffMod.diffTools(null, toolFile), row, { forced: true });
    forward = files.forward;
    rollback = files.rollback;
    // The files the workflow would accept, and nothing else.
    expect(checkRegistryFile(forward).server).toBe("insert");
    expect(checkRegistryFile(rollback).server).toBe("delete");
  }, 120_000);

  afterAll(async () => {
    await stopTestDb();
  });

  beforeEach(async () => {
    await seed();
  });

  it("the forward adds the server row on the lowest free port and its six tools; the rollback reverts it all", async () => {
    expect(toolNames).toHaveLength(6);
    const before = await snapshot();

    await runAsRole(forward);
    const after = await snapshot();

    const added = after.servers.filter((s) => s.slug === SLUG);
    expect(added).toHaveLength(1);
    const manifest = readJson("plugins/notion-mcp/datatorag.json");
    expect(added[0]).toMatchObject({
      name: manifest.name,
      description: manifest.description,
      status: "active",
      container_port: 40002,
      github_repo_url: "https://github.com/datatorag/mcp-gateway/tree/main/plugins/notion-mcp",
      license_spdx: null,
    });
    expect(JSON.parse(String(added[0].manifest))).toEqual(manifest);
    const joined = after.tools.filter((t) => t.slug === SLUG);
    expect(joined.map((t) => t.name).sort()).toEqual([...toolNames].sort());
    expect(joined.every((t) => t.read_only_hint === true && t.enabled === true)).toBe(true);
    // The other plugins' rows are untouched, column for column.
    expect(after.servers.filter((s) => s.slug !== SLUG)).toEqual(before.servers);
    expect(after.tools.filter((t) => t.slug !== SLUG)).toEqual(before.tools);

    await runAsRole(rollback);
    expect(await snapshot()).toEqual(before);
  });

  it("the port is the lowest one no row holds, not the next after the highest", async () => {
    await seed([40000, 40002]);
    await runAsRole(forward);
    const [row] = [...(await db.execute(sql.raw(`SELECT container_port FROM mcp_servers WHERE slug = '${SLUG}'`)))];
    expect(row.container_port).toBe(40001);
  });

  it("known-bad: the forward run twice refuses the second time and changes nothing", async () => {
    await runAsRole(forward);
    const once = await snapshot();
    expect(await refusal(forward)).toBe(`forward mcp_servers ${SLUG}: expected 1 row, inserted 0`);
    expect(await snapshot()).toEqual(once);
  });

  it("known-bad: the rollback refuses, and changes nothing, after a tool's description was changed by hand", async () => {
    await runAsRole(forward);
    await db.execute(
      sql.raw(`UPDATE tools SET description = description || ' (edited)' WHERE namespaced_name = '${SLUG}__notion_search'`)
    );
    const edited = await snapshot();
    expect(await refusal(rollback)).toBe("rollback notion_search: expected 1 row, deleted 0");
    expect(await snapshot()).toEqual(edited);
  });

  it("known-bad: the rollback refuses, and the cascade removes nothing, while an env var row points at the server", async () => {
    await runAsRole(forward);
    await db.execute(
      sql.raw(`INSERT INTO mcp_server_env_vars (mcp_server_id, key, value) SELECT id, 'SOME_KEY', 'v' FROM mcp_servers WHERE slug = '${SLUG}'`)
    );
    const held = await snapshot();
    expect(held.envVars).toHaveLength(1);
    expect(await refusal(rollback)).toBe(`rollback mcp_servers ${SLUG}: expected 1 row, deleted 0`);
    expect(await snapshot()).toEqual(held);
  });

  it("known-bad: the rollback refuses, and a user's plugin connection survives, while one points at the server", async () => {
    await runAsRole(forward);
    const userId = await insertTestUser(db);
    await db.execute(
      sql`INSERT INTO plugin_connections (user_id, mcp_server_id, provider, access_token) SELECT ${userId}::uuid, id, 'notion', 'not-a-token' FROM mcp_servers WHERE slug = ${SLUG}`
    );
    const held = await snapshot();
    expect(held.connections).toHaveLength(1);
    expect(await refusal(rollback)).toBe(`rollback mcp_servers ${SLUG}: expected 1 row, deleted 0`);
    expect(await snapshot()).toEqual(held);
  });

  it("known-bad: a row someone else gave the slug makes the forward refuse, and it writes nothing", async () => {
    await db.execute(
      sql.raw(`INSERT INTO mcp_servers (slug, name, container_port, status) VALUES ('${SLUG}', 'Hand-made', 40009, 'disabled')`)
    );
    const held = await snapshot();
    expect(await refusal(forward)).toBe(`forward mcp_servers ${SLUG}: expected 1 row, inserted 0`);
    expect(await snapshot()).toEqual(held);
  });
});
