// Tests of the registry apply step (SCRUM-423), with the database replaced
// by a recorder. Run with: node --test scripts/registry-apply.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyRegistryFile } from "./registry-apply.mjs";
import { sha256Of } from "./registry-file-check.mjs";

const PATH = "registry/2026-10-13-scrum-421-drive-upload-file.sql";
const TEXT = readFileSync(new URL(`../${PATH}`, import.meta.url), "utf8");
const SHA = sha256Of(TEXT);
// A fake connection string, assembled from parts so no connection-string
// literal sits in the repo for the leak scan (which looks for them) to
// match; the parts are what the tests look for in the output.
const URL_FIXTURE = ["postgres", "://", "writer", ":", "secret-fixture", "@", "db.example.test", "/registry"].join("");

/** A postgres.js-shaped stand-in that records what is sent. */
function fakeDb({ scs = "on", fail = null, rows = [{ name: "drive_upload_file", description_md5: "e".repeat(32), schema_md5: "f".repeat(32), read_only_hint: false, updated_at: new Date("2026-10-14T00:00:00Z") }] } = {}) {
  const sent = [];
  let ended = false;
  const sql = {
    unsafe(text) {
      return {
        simple: async () => {
          sent.push({ text, simple: true });
          if (text === "SHOW standard_conforming_strings") return [{ standard_conforming_strings: scs }];
          if (fail) throw fail;
          return [[], [], [], rows];
        },
      };
    },
    end: async () => {
      ended = true;
    },
  };
  return { sql, sent, ended: () => ended };
}

const run = (over = {}, db = fakeDb()) =>
  applyRegistryFile({ path: PATH, text: TEXT, sha256: SHA, url: URL_FIXTURE, connect: () => db.sql, ...over });

test("sends the file's exact bytes once, as a simple query, after checking the session reads literals as the check did", async () => {
  const db = fakeDb();
  const { code, out } = await run({}, db);
  assert.equal(code, 0);
  assert.deepEqual(db.sent.map((s) => s.text), ["SHOW standard_conforming_strings", TEXT]);
  assert.ok(db.sent.every((s) => s.simple));
  assert.ok(out.some((l) => l.includes("drive_upload_file") && l.includes("description_md5=" + "e".repeat(32))));
  assert.ok(db.ended());
});

test("refuses a file whose sha256 is not the approved one, and never connects", async () => {
  let connected = false;
  const { code, out } = await run({ sha256: "0".repeat(64), connect: () => ((connected = true), fakeDb().sql) });
  assert.equal(code, 1);
  assert.match(out.join("\n"), /not the 0{64} that was approved/);
  assert.equal(connected, false);
});

test("refuses a file that fails the check, even with a matching sha256, and never connects", async () => {
  const bad = TEXT + "DELETE FROM users;\n";
  let connected = false;
  const { code } = await run({ text: bad, sha256: sha256Of(bad), connect: () => ((connected = true), fakeDb().sql) });
  assert.equal(code, 1);
  assert.equal(connected, false);
});

test("refuses to run when the session would read backslashes differently", async () => {
  const db = fakeDb({ scs: "off" });
  const { code, out } = await run({}, db);
  assert.equal(code, 1);
  assert.match(out.join("\n"), /standard_conforming_strings/);
  assert.deepEqual(db.sent.map((s) => s.text), ["SHOW standard_conforming_strings"]);
});

test("with no connection configured, says so and runs nothing", async () => {
  const { code, out } = await run({ url: undefined });
  assert.equal(code, 1);
  assert.match(out.join("\n"), /no registry connection/);
});

test("shows a guard's own message when a guard stopped the change", async () => {
  const err = Object.assign(new Error("forward drive_upload_file: expected 1 row, inserted 0"), { code: "P0001" });
  const { code, out } = await run({}, fakeDb({ fail: err }));
  assert.equal(code, 1);
  assert.match(out.join("\n"), /rolled back: forward drive_upload_file: expected 1 row, inserted 0/);
});

test("never prints a server or network error, which can quote the connection", async () => {
  for (const err of [
    Object.assign(new Error(`connect ECONNREFUSED db.example.test:5432 ${URL_FIXTURE}`), { code: "ECONNREFUSED" }),
    Object.assign(new Error(`password authentication failed for user "writer" at db.example.test`), { code: "28P01" }),
    Object.assign(new Error(`some raise that is not the generator's, quoting ${URL_FIXTURE}`), { code: "P0001" }),
  ]) {
    const { code, out } = await run({}, fakeDb({ fail: err }));
    const text = out.join("\n");
    assert.equal(code, 1);
    for (const secret of ["secret-fixture", "db.example.test", "ECONNREFUSED", "writer"]) assert.ok(!text.includes(secret), secret);
  }
});

test("nothing it prints, on success, contains the connection string or its parts", async () => {
  const { out } = await run();
  const text = out.join("\n");
  for (const secret of ["secret-fixture", "db.example.test", URL_FIXTURE]) assert.ok(!text.includes(secret), secret);
});
