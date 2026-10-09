import { describe, expect, it, vi } from "vitest";

const execFile = vi.fn();
vi.mock("node:child_process", () => ({
  execFile: (...args: unknown[]) => execFile(...args),
  spawn: vi.fn(),
}));

const { CliTransport, ARGV_STRING_MAX } = await import("./cli-transport.js");

/* The fallback keeps the limits of the transport it is (SCRUM-289). They are
 * gone from the hosted path, not from the CLI. */
describe("the CLI fallback transport", () => {
  it("still refuses a body that cannot travel as one argv string, before starting the binary", async () => {
    const cli = new CliTransport({});
    await expect(
      cli.api("gmail", "users.messages", "send", { params: { userId: "me" }, jsonBody: { raw: "x".repeat(ARGV_STRING_MAX) } })
    ).rejects.toThrow(/can carry at most/);
    expect(execFile).not.toHaveBeenCalled();
  });

  it("says how to install the CLI when the binary is not there", async () => {
    execFile.mockImplementation((_bin: string, _args: string[], _opts: unknown, cb: (e: unknown) => void) =>
      cb(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" }))
    );
    await expect(new CliTransport({}).api("tasks", "tasklists", "list")).rejects.toThrow(/npm run download-binaries/);
  });

  it("passes the arguments the binary has always been given", async () => {
    execFile.mockReset();
    execFile.mockImplementation((_bin: string, _args: string[], _opts: unknown, cb: (e: unknown, out: unknown) => void) =>
      cb(null, { stdout: '{"ok":true}', stderr: "" })
    );
    const out = await new CliTransport({}).api("gmail", "users.messages", "list", {
      params: { userId: "me", labelIds: ["INBOX"] },
      pageAll: true,
    });
    expect(out.data).toEqual({ ok: true });
    expect(execFile.mock.calls[0][1]).toEqual([
      "gmail", "users", "messages", "list",
      "--params", '{"userId":"me","labelIds":["INBOX"]}',
      "--page-all", "--page-limit", "10",
    ]);
  });
});
