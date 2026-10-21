-- The role the registry workflow connects as (SCRUM-423). PROPOSAL: run once
-- on production by a person, on a confirmation that names the database.
--
-- It can read the two registry tables, add and remove rows of `tools`, and
-- change four columns of a row. Since SCRUM-366 it can also add a new
-- plugin's `mcp_servers` row (the ten columns a new-plugin file writes) and
-- remove one, and read the one column, mcp_server_id, of the two other tables
-- that point at `mcp_servers`, so the rollback can refuse while either holds a
-- row for the server: their cascade would otherwise delete env vars and a
-- user's plugin connection with it. Nothing else: no other table, no schema
-- change, no role or database rights.
--
-- One limit the role does NOT enforce: Postgres runs ON DELETE CASCADE as the
-- table's owner, so a DELETE on mcp_servers issued as this role outside a
-- checked file would also remove that server's env vars and users' plugin
-- connections. The refusal while those rows exist is in the generated
-- rollback and is enforced by scripts/registry-file-check.mjs, not by this
-- grant. Before SCRUM-366 a file that got past the check could only change
-- registry rows; with the DELETE grant, that holds only for files the check
-- accepted. Two new-plugin files must also never run at the same time: the
-- port is re-checked after the insert, but container_port carries no unique
-- constraint, and the workflow's concurrency group is what serialises runs.
--
-- PROPOSAL, NOT APPLIED (SCRUM-366). The four lines marked SCRUM-366 below are
-- new. The role already exists on production, so this file is not re-run:
-- HQ applies those four GRANT lines to the existing role, as an administrator,
-- and re-runs the checks at the end, before the workflow can run a
-- new-plugin file. Until then a person runs such a file.
--
-- CREATED HERE BY SQL, NEVER IN THE PROVIDER'S CONSOLE: a role made in the
-- console is given membership of the provider's administrative role, which
-- would undo every line below.
--
-- NO PASSWORD IN THIS FILE. The role is created unable to log in. Its
-- password is set afterwards by the person who will hold it, so that the
-- password never appears as SQL text anywhere (a SQL editor's history and
-- the server's statement log can both keep an `ALTER ROLE ... PASSWORD`):
-- in a psql session as an administrator,
--   \password registry_writer
--   ALTER ROLE registry_writer LOGIN;
-- `\password` hashes the password on the client before sending it. The
-- resulting connection string goes into the parameter store and the
-- `production` environment's REGISTRY_DATABASE_URL secret, in that order.

BEGIN;
CREATE ROLE registry_writer NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 2;

GRANT USAGE ON SCHEMA public TO registry_writer;
GRANT SELECT ON mcp_servers TO registry_writer;
GRANT SELECT, DELETE ON tools TO registry_writer;
GRANT INSERT (mcp_server_id, name, namespaced_name, description, input_schema_json, read_only_hint) ON tools TO registry_writer;
GRANT UPDATE (description, input_schema_json, read_only_hint, updated_at) ON tools TO registry_writer;
-- SCRUM-366: a new plugin's server row, its insert and its rollback's delete.
GRANT INSERT (slug, name, description, github_repo_url, github_repo_owner, github_repo_name, license_spdx, manifest_json, status, container_port) ON mcp_servers TO registry_writer;
GRANT DELETE ON mcp_servers TO registry_writer;
-- SCRUM-366: the rollback's cascade guards read this one column, and no other.
GRANT SELECT (mcp_server_id) ON mcp_server_env_vars TO registry_writer;
GRANT SELECT (mcp_server_id) ON plugin_connections TO registry_writer;

-- The check reads string literals with standard_conforming_strings on; the
-- server must read them the same way. The workflow also sets it on connect
-- and refuses to run if it is not on.
ALTER ROLE registry_writer SET standard_conforming_strings = on;
ALTER ROLE registry_writer SET search_path = public;
ALTER ROLE registry_writer SET statement_timeout = '30s';
ALTER ROLE registry_writer SET lock_timeout = '5s';
ALTER ROLE registry_writer SET idle_in_transaction_session_timeout = '60s';
COMMIT;

-- AFTER IT RUNS, these must hold. Each query's expected answer is on its
-- comment line; any other answer means stop and drop the role.
--
-- No membership of any other role (expected: no rows):
SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid
WHERE m.member = 'registry_writer'::regrole;
--
-- No special attribute (expected: one row, every column false):
SELECT rolsuper, rolcreaterole, rolcreatedb, rolreplication, rolbypassrls, rolinherit
FROM pg_roles WHERE rolname = 'registry_writer';
--
-- Table rights are exactly these (expected: mcp_servers DELETE, SELECT; tools DELETE, SELECT):
SELECT table_name, privilege_type FROM information_schema.role_table_grants
WHERE grantee = 'registry_writer' ORDER BY table_name, privilege_type;
--
-- Column rights for writing are exactly these (expected: INSERT on the six
-- columns above, UPDATE on the four). The table-wide SELECT also lists every
-- column as SELECT, which is why the query keeps to INSERT and UPDATE:
SELECT privilege_type, column_name FROM information_schema.column_privileges
WHERE grantee = 'registry_writer' AND table_name = 'tools' AND privilege_type IN ('INSERT', 'UPDATE')
ORDER BY privilege_type, column_name;
--
-- And on mcp_servers (expected: INSERT on exactly the ten columns of the
-- SCRUM-366 grant above, and no UPDATE):
SELECT privilege_type, column_name FROM information_schema.column_privileges
WHERE grantee = 'registry_writer' AND table_name = 'mcp_servers' AND privilege_type IN ('INSERT', 'UPDATE')
ORDER BY privilege_type, column_name;
--
-- On the two tables the cascade guards read (expected: two rows, SELECT on
-- mcp_server_id of each; no other column, so no token or env var value):
SELECT table_name, privilege_type, column_name FROM information_schema.column_privileges
WHERE grantee = 'registry_writer' AND table_name IN ('mcp_server_env_vars', 'plugin_connections')
ORDER BY table_name, column_name;
--
-- No right to create in the schema (expected: false):
SELECT has_schema_privilege('registry_writer', 'public', 'CREATE');
--
-- No table-wide right on any other table in the schema, by any route, PUBLIC
-- included (expected: no rows; the column grants above are not table-wide):
SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p', 'v', 'm')
  AND c.relname NOT IN ('tools', 'mcp_servers')
  AND (has_table_privilege('registry_writer', c.oid, 'SELECT')
    OR has_table_privilege('registry_writer', c.oid, 'INSERT')
    OR has_table_privilege('registry_writer', c.oid, 'UPDATE')
    OR has_table_privilege('registry_writer', c.oid, 'DELETE'));
