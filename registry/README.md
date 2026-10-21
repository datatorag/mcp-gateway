# registry/

Production changes to the `tools` registry, and the `mcp_servers` row of a new plugin, one file per change, run by the `registry` workflow
(`.github/workflows/registry.yml`) after the `production` environment's approval. The design is
`docs/architecture/2026-10-14-scrum-423-registry-writes-through-the-pipeline.md`.

## What lives here

- `<date>-<change>.sql`: a forward change, and `<date>-<change>.rollback.sql`: its rollback,
  committed together. Each is one transaction in exactly the shape `scripts/registry-diff.mjs`
  writes: every row statement guarded by the md5 of the row it expects, a row count at the end,
  a read of the rows it touched. `scripts/registry-file-check.mjs` refuses anything else, and the
  gate runs it over every file here, so a file that would be refused fails CI before anyone can
  dispatch it.
- `roles/registry-writer.sql`: the restricted role the workflow connects as. Run once, by a
  person; not through the workflow (the workflow cannot name a file under `roles/`).

A file's header is what the generator wrote when the file was made, `PROPOSAL: NOT RUN`
included, and it is kept byte for byte so its sha256 stays the one that was approved. Whether
and when a file ran is in the workflow's run record, not in the file.

Nothing here holds a secret. The files carry tool descriptions and schemas, which the plugins
already publish, and md5s.

## Producing a file

From two gateway commits on `main`, the one that is running and the one about to be:

```
pnpm registry:diff <plugin slug> --from <running sha> --to <new sha> --out registry/
```

Rename the two files it writes to `<date>-<change>.sql` and `<date>-<change>.rollback.sql`,
check them with `node scripts/registry-file-check.mjs <file>`, and commit them in a pull request.
A hand-written change has to be written in the same shape, or the check refuses it.

### A new plugin

A new plugin goes through the same command, from the running sha to the sha that adds it. When
`plugins/<slug>` does not exist at the running sha, the generator reads the missing tool file as
an empty tool set, and the forward file opens with one more statement: the insert of the
plugin's `mcp_servers` row, before its tool inserts, in the same transaction. A missing tool file
for a plugin that did exist at the running sha, or a build record from before tool files were
kept, still refuses.

Once an image holding `plugins/<slug>` is running, that automatic rule no longer sees the plugin
as new, though its rows may still not exist. For that case, say so:

```
pnpm registry:diff <plugin slug> --from <running sha> --to <new sha> --out registry/ --new-plugin
```

`--new-plugin` forces the empty base and the server insert whatever the running sha holds; it
reads nothing of that commit but its sha, for the header. It refuses only when the new sha has no
`plugins/<slug>`. Forcing is safe because the insert raises if a row for the slug exists, and then
the transaction writes nothing.

The row's values come from the plugin's files at the new sha and from what the plugin manager
needs to start it from the image:

| Column | Value |
|---|---|
| `slug` | the plugin's directory name |
| `name` | `name` in `datatorag.json` (required) |
| `description` | `description` in `datatorag.json`, else in `package.json`, else NULL |
| `manifest_json` | `datatorag.json` as it is |
| `license_spdx` | `license` in `package.json`, else NULL |
| `github_repo_url`, `_owner`, `_name` | this repository, `https://github.com/<owner>/<repo>/tree/main/plugins/<slug>`. Not only a link: a call is sent to `localhost:<port>` only when this is set |
| `status` | `active`, the only status the manager starts and the tool listing reads |
| `container_port` | chosen by the statement: the lowest port from 40000 that no `mcp_servers` row holds (the manager's own rule), then checked to be held by this row alone |
| everything else | the column's default |

The insert raises if a row with that slug exists. The rollback deletes the tool rows and then the
server row, guarded by the md5 of every column the forward wrote except the port, and refuses while
any `tools`, `mcp_server_env_vars` or `plugin_connections` row points at it. Those three tables
cascade on delete, so without the guard a rollback could take a user's plugin connection with it. The check accepts the server insert only as a forward file's first
statement followed by tool inserts alone, and the delete only as a rollback's last statement after
tool deletes alone.

**The role needs a grant change first, and applying it is HQ's.** `roles/registry-writer.sql`
carries the four new GRANT lines, marked SCRUM-366: INSERT on exactly the ten columns the forward
writes, DELETE on `mcp_servers`, and SELECT on the `mcp_server_id` column alone of
`mcp_server_env_vars` and `plugin_connections` for the rollback's guard. The role already exists
on production, so the file is not re-run; HQ applies those four lines to it and re-runs the
file's checks. Until then the workflow cannot run a new-plugin file, and a person runs it.

## Running one

After the file is on `main`, and after a person has said go in words, for this file and this
sha256:

```
gh workflow run registry.yml --ref main \
  -f file=registry/<date>-<change>.sql \
  -f sha256=<sha256 of the file that will run>
```

For the rollback, the same `file` with `-f rollback=true` and the rollback file's sha256.

The run's name carries the file and the sha256. The `request` job shows the rows the file
touches and its full text. **The approval of the run in GitHub, from any device, is the second
confirmation.** The approver checks that the sha256 in the run's name is the one they were shown.
The `apply` job prints the rows as they are after the change.

## Order against a deploy

A new tool: its row first, then the deploy of the image that serves it. A removed tool: the
deploy first, then the row goes. Between the two the drift check (runner case A4) is red by
design; it is advisory, not a gate.

A new plugin is different, because the plugin's process starts only at gateway boot, from the
active rows it finds then, and a gateway that does not map the slug in `PLUGIN_SERVICE_MAP` lists
the plugin's tools to every user. Rows first: until the deploy, the running gateway lists the new
tools to everyone and every call fails. Image first: nothing is listed until the rows run, and
then the tools are listed to the users who connected the service, and fail, until the gateway
restarts and starts the plugin. Which order is ruled per plugin; see the plugin's plan.
