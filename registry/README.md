# registry/

Production changes to the `tools` registry, one file per change, run by the `registry` workflow
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
