import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Both directions of the CLI identity guard, against a stand-in binary.
 *
 * A guard only ever observed to allow is not a guard, so every case here
 * asserts what the binary was and was not asked to do, not only what the
 * wrapper printed. The stand-in records its own argv, which is the only way to
 * tell "refused" from "ran the write and said something disapproving".
 *
 * The stand-in is not the real CLI and cannot prove anything about the real
 * one's behaviour; it pins the wrapper's decisions. The wrapper against a real
 * binary and a real account is a separate, manual control.
 */

const GUARD = path.join(process.cwd(), "scripts", "gws-guard.sh");

interface Run {
  code: number;
  stdout: string;
  stderr: string;
  /** One line per invocation of the stand-in binary, in order. */
  invocations: string[];
}

/** Writes a stand-in `gws` that logs its argv and answers the identity call. */
function standInBinary(identity: string): { bin: string; log: string } {
  const dir = mkdtempSync(path.join(os.tmpdir(), "gws-guard-"));
  const log = path.join(dir, "invocations.log");
  const bin = path.join(dir, "gws");
  writeFileSync(
    bin,
    `#!/usr/bin/env bash
printf '%s\\n' "$*" >> ${JSON.stringify(log)}
if [[ "$1" == "--version" ]]; then echo "gws 0.0.0-stand-in"; exit 0; fi
if [[ "$1" == "drive" && "$2" == "about" && "$3" == "get" ]]; then
  printf '{"user":{"emailAddress":"%s"}}\\n' ${JSON.stringify(identity)}
  exit 0
fi
echo '{"ok":true}'
`
  );
  chmodSync(bin, 0o755);
  writeFileSync(log, "");
  return { bin, log };
}

function runGuard(args: string[], identity = "owner@example.com"): Promise<Run> {
  const { bin, log } = standInBinary(identity);
  return new Promise((resolve) => {
    execFile(
      "bash",
      [GUARD, ...args],
      { env: { ...process.env, GWS_BIN: bin, GWS_EXPECT_ACCOUNT: "" } },
      (err, stdout, stderr) => {
        resolve({
          code: (err as { code?: number } | null)?.code ?? 0,
          stdout,
          stderr,
          invocations: readFileSync(log, "utf-8").split("\n").filter(Boolean),
        });
      }
    );
  });
}

const WRITE = ["tasks", "tasklists", "insert", "--json", '{"title":"Q3"}'];

describe("gws-guard blocks a write with no stated identity", () => {
  it("refuses, and the binary is never invoked at all", async () => {
    const run = await runGuard(WRITE);

    expect(run.code).toBe(9);
    expect(run.stderr).toMatch(/REFUSED/);
    expect(run.stderr).toMatch(/no identity was stated/);
    // Not one call, not even the identity lookup: there is nothing to look up
    // against. This also catches the failure where the guard prints a warning
    // and runs the write anyway.
    expect(run.invocations).toEqual([]);
  });

  it("refuses when the stated identity is not the acting one", async () => {
    const run = await runGuard(["--as", "someone@example.com", ...WRITE], "owner@example.com");

    expect(run.code).toBe(9);
    expect(run.stderr).toMatch(/identity mismatch/);
    expect(run.stderr).toContain("someone@example.com");
    expect(run.stderr).toContain("owner@example.com");
    // It resolved the identity and then stopped. The write must not appear.
    expect(run.invocations).toContain(
      'drive about get --params {"fields":"user/emailAddress"}'
    );
    expect(run.invocations.join("\n")).not.toMatch(/tasklists insert/);
  });
});

describe("gws-guard allows a write whose identity matches", () => {
  it("echoes the acting identity and forwards the command unchanged", async () => {
    const run = await runGuard(["--as", "owner@example.com", ...WRITE], "owner@example.com");

    expect(run.code).toBe(0);
    expect(run.stderr).toMatch(/acting as owner@example\.com/);
    expect(run.invocations).toContain(
      'tasks tasklists insert --json {"title":"Q3"}'
    );
    // `--as` is the guard's, not the CLI's: forwarding it would be a usage error.
    expect(run.invocations.join("\n")).not.toMatch(/--as/);
  });

  it("accepts the identity from GWS_EXPECT_ACCOUNT too", async () => {
    const { bin, log } = standInBinary("owner@example.com");
    const run = await new Promise<Run>((resolve) => {
      execFile(
        "bash",
        [GUARD, ...WRITE],
        { env: { ...process.env, GWS_BIN: bin, GWS_EXPECT_ACCOUNT: "owner@example.com" } },
        (err, stdout, stderr) =>
          resolve({
            code: (err as { code?: number } | null)?.code ?? 0,
            stdout,
            stderr,
            invocations: readFileSync(log, "utf-8").split("\n").filter(Boolean),
          })
      );
    });

    expect(run.code).toBe(0);
    expect(run.invocations.join("\n")).toMatch(/tasklists insert/);
  });

  it("compares addresses case-insensitively", async () => {
    const run = await runGuard(["--as", "Owner@Example.COM", ...WRITE], "owner@example.com");
    expect(run.code).toBe(0);
  });
});

describe("gws-guard leaves reads cheap", () => {
  it("passes a read through without resolving identity", async () => {
    const run = await runGuard(["tasks", "tasklists", "list"]);

    expect(run.code).toBe(0);
    // Exactly one invocation: the read. An identity call here would be a cost
    // paid on every list, get and search the CLI ever runs.
    expect(run.invocations).toEqual(["tasks tasklists list"]);
  });

  it("passes auth through, since that is where an identity comes from", async () => {
    const run = await runGuard(["auth", "status"]);
    expect(run.code).toBe(0);
    expect(run.invocations).toEqual(["auth status"]);
  });
});

describe("gws-guard fails closed on methods it does not recognise", () => {
  it.each([
    ["calendar", "events", "move"],
    ["gmail", "users", "messages", "trash"],
    ["drive", "permissions", "create"],
    ["sheets", "spreadsheets", "batchUpdate"],
  ])("treats %s %s %s as a write", async (...argv) => {
    const run = await runGuard(argv);
    expect(run.code).toBe(9);
    expect(run.invocations).toEqual([]);
  });

  it("treats a helper command as a write", async () => {
    // Helper commands carry their verb in a `+command` token, so the
    // method-name rule cannot read them. Unrecognised has to mean write.
    const run = await runGuard(["sheets", "+export", "someid"]);
    expect(run.code).toBe(9);
  });
});

describe("the classification itself cannot go blind", () => {
  it("still lets a known read through and still stops a known write", async () => {
    // Two assertions that fail in opposite directions. A rule that stopped
    // matching anything would pass every "is it blocked" test by blocking
    // everything, or every "does it work" test by blocking nothing.
    const read = await runGuard(["drive", "files", "list"]);
    const write = await runGuard(["drive", "files", "delete"]);
    expect(read.code).toBe(0);
    expect(write.code).toBe(9);
  });
});
