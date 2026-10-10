import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/* SCRUM-390: how a plugin child is started. These start REAL child processes
 * from throwaway plugin folders, because both things under test are only true
 * of a real spawn: what the child can read from its environment, and how many
 * times a child that keeps exiting is started again.
 *
 * Each has a known-bad form. Hand the child the gateway's environment again
 * and the marker test goes red. Lose the restart count again and the crash
 * test counts past four starts (the fixture stops itself at twenty so the bad
 * form fails instead of running forever). */

const home = mkdtempSync(join(tmpdir(), "plugin-spawn-"));
vi.mock("node:os", async (orig) => ({
  ...(await orig<typeof import("node:os")>()),
  homedir: () => home,
}));
vi.mock("@/lib/slack", () => ({ sendSlack: vi.fn() }));

const { mcpServers, mcpServerEnvVars } = await import("@datatorag-mcp/db");
const { PluginManager, PLUGINS_DIR, buildPluginEnv, pluginsDirFrom, pluginUserFrom } =
  await import("./plugin-manager");
type PluginUserLookup = import("./plugin-manager").PluginUserLookup;

type Row = { key: string; value: string };
type Server = { id: string; slug: string; containerPort: number };

function makeManager(servers: Server[], rows: Row[] = [], userFor?: PluginUserLookup) {
  const db = {
    select: () => ({
      from: (table: unknown) => ({
        where: async () =>
          table === mcpServers ? servers : table === mcpServerEnvVars ? rows : [],
      }),
    }),
  };
  return new PluginManager(db as never, {} as never, userFor ? { userFor } : {});
}

function writePlugin(slug: string, source: string): string {
  const dir = join(PLUGINS_DIR, slug);
  mkdirSync(join(dir, "server"), { recursive: true });
  writeFileSync(join(dir, "server", "index.js"), source);
  return dir;
}

async function until(check: () => boolean, ms = 15_000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("timed out waiting");
    await new Promise((r) => setTimeout(r, 25));
  }
}

const MARKER = "SCRUM390_PARENT_ONLY_MARKER";
let manager: InstanceType<typeof PluginManager> | undefined;

beforeEach(() => {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(async () => {
  // The folder removed below must be the throwaway one, never a real one.
  expect(PLUGINS_DIR.startsWith(home)).toBe(true);
  await manager?.stopAll();
  manager = undefined;
  delete process.env[MARKER];
  vi.restoreAllMocks();
  rmSync(PLUGINS_DIR, { recursive: true, force: true });
});

describe("a plugin child's environment", () => {
  // Writes the child's environment to a file, then stays up until stopped.
  const dumpEnv = `
    require("node:fs").writeFileSync("env.json", JSON.stringify(process.env));
    setInterval(() => {}, 1000);
  `;

  it("holds PATH, NODE_ENV, PORT and the plugin's own rows, and nothing of the gateway's", async () => {
    process.env[MARKER] = "must-not-reach-the-child";
    const dir = writePlugin("env-plugin", dumpEnv);
    manager = makeManager(
      [{ id: "s1", slug: "env-plugin", containerPort: 40123 }],
      [{ key: "PLUGIN_OWN_SETTING", value: "literal" }]
    );

    await manager.startAll();
    await until(() => existsSync(join(dir, "env.json")));
    const env = JSON.parse(readFileSync(join(dir, "env.json"), "utf-8"));

    expect(env[MARKER]).toBeUndefined();
    expect(env.PORT).toBe("40123");
    expect(env.PATH).toBe(process.env.PATH);
    expect(env.PLUGIN_OWN_SETTING).toBe("literal");
    // The child's names are exactly the short list. macOS adds one name of
    // its own to every process it starts; that one is not the gateway's.
    const names = Object.keys(env).filter((k) => k !== "__CF_USER_TEXT_ENCODING");
    expect(names.sort()).toEqual(["NODE_ENV", "PATH", "PLUGIN_OWN_SETTING", "PORT"]);
  });

  it("refuses a row value starting with $ and a row with a reserved key, in the child as well", async () => {
    process.env[MARKER] = "must-not-reach-the-child";
    const dir = writePlugin("row-plugin", dumpEnv);
    manager = makeManager(
      [{ id: "s1", slug: "row-plugin", containerPort: 40124 }],
      [
        { key: "COPIED", value: `$${MARKER}` },
        { key: "PORT", value: "1" },
        { key: "NODE_OPTIONS", value: "--inspect" },
        { key: "LD_PRELOAD", value: "/tmp/x.so" },
        { key: "KEPT", value: "kept" },
      ]
    );

    await manager.startAll();
    await until(() => existsSync(join(dir, "env.json")));
    const env = JSON.parse(readFileSync(join(dir, "env.json"), "utf-8"));

    expect(env.COPIED).toBeUndefined();
    expect(env.PORT).toBe("40124");
    expect(env.NODE_OPTIONS).toBeUndefined();
    expect(env.LD_PRELOAD).toBeUndefined();
    expect(env.KEPT).toBe("kept");
    expect(JSON.stringify(env)).not.toContain("must-not-reach-the-child");
  });
});

describe("buildPluginEnv", () => {
  const parent = {
    PATH: "/bin",
    NODE_ENV: "production",
    DATABASE_URL: "gateway-only-database-url",
    SECRET_THING: "gateway-only",
  };

  it("passes only the short list from the parent", () => {
    const { env, refused } = buildPluginEnv(parent, 40000, []);
    expect(env).toEqual({ PATH: "/bin", NODE_ENV: "production", PORT: "40000" });
    expect(refused).toEqual([]);
  });

  it("passes a row as written and never reads the parent for it", () => {
    const { env } = buildPluginEnv(parent, 40000, [
      { key: "A", value: "plain" },
      { key: "B", value: "has $SECRET_THING inside" },
    ]);
    expect(env.A).toBe("plain");
    expect(env.B).toBe("has $SECRET_THING inside");
  });

  it("refuses a $ value: left out, not copied and not passed as a literal", () => {
    const { env, refused } = buildPluginEnv(parent, 40000, [
      { key: "COPIED", value: "$SECRET_THING" },
    ]);
    expect("COPIED" in env).toBe(false);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toContain("COPIED");
    expect(refused[0]).not.toContain("SECRET_THING");
  });

  it("refuses a key that is not a plain variable name, so a key cannot carry its own =", () => {
    const { env, refused } = buildPluginEnv(parent, 40000, [
      { key: "NODE_OPTIONS=--require", value: "/tmp/from-a-row.js" },
      { key: "LD_PRELOAD=/tmp/x.so;A", value: "from-a-row" },
      { key: "", value: "from-a-row" },
      { key: " SPACED", value: "from-a-row" },
    ]);
    expect(env).toEqual({ PATH: "/bin", NODE_ENV: "production", PORT: "40000" });
    expect(refused).toHaveLength(4);
    expect(refused.join("\n")).not.toContain("from-a-row");
    // Nothing of a malformed key is printed either: it is most likely a
    // value in the wrong column.
    for (const part of ["NODE_OPTIONS", "--require", "LD_PRELOAD", "SPACED"]) {
      expect(refused.join("\n")).not.toContain(part);
    }
  });

  it.each(["PORT", "PATH", "NODE_ENV", "NODE_OPTIONS", "LD_PRELOAD", "LD_LIBRARY_PATH"])(
    "refuses the reserved key %s",
    (key) => {
      const { env, refused } = buildPluginEnv(parent, 40000, [
        { key, value: "from-a-row" },
      ]);
      expect(Object.values(env)).not.toContain("from-a-row");
      expect(refused).toHaveLength(1);
      expect(refused[0]).not.toContain("from-a-row");
    }
  );
});

describe("the restart limit", () => {
  it("restarts a plugin that exits at once three times, then reports it down", async () => {
    // Counts its own starts in a file, then crashes. At twenty starts it
    // exits cleanly, which ends any restart loop: a manager that has lost
    // the count fails the assertion below instead of running forever.
    const dir = writePlugin(
      "crash-plugin",
      `
      const fs = require("node:fs");
      fs.appendFileSync("starts", "x");
      process.exit(fs.readFileSync("starts", "utf-8").length >= 20 ? 0 : 1);
    `
    );
    writePlugin("steady-plugin", `setInterval(() => {}, 1000);`);
    manager = makeManager([
      { id: "s1", slug: "crash-plugin", containerPort: 40125 },
      { id: "s2", slug: "steady-plugin", containerPort: 40126 },
    ]);
    const starts = () =>
      existsSync(join(dir, "starts"))
        ? readFileSync(join(dir, "starts"), "utf-8").length
        : 0;

    await manager.startAll();
    expect(manager.pluginStatus()["steady-plugin"]).toBe("up");

    await until(
      () => manager!.pluginStatus()["crash-plugin"] === "down" || starts() >= 20
    );
    // Let a restart that should not happen show itself.
    await new Promise((r) => setTimeout(r, 300));

    expect(starts()).toBe(4); // the first start and three restarts
    expect(manager.pluginStatus()).toEqual({
      "crash-plugin": "down",
      "steady-plugin": "up",
    });
  });

  it("does not restart a plugin it stopped, even one that exits non-zero on the way out", async () => {
    const dir = writePlugin(
      "stopped-plugin",
      `
      require("node:fs").appendFileSync("starts", "x");
      process.on("SIGTERM", () => process.exit(1));
      setInterval(() => {}, 1000);
    `
    );
    manager = makeManager([{ id: "s1", slug: "stopped-plugin", containerPort: 40129 }]);
    await manager.startAll();
    await until(() => existsSync(join(dir, "starts")));
    await new Promise((r) => setTimeout(r, 200)); // the handler is installed
    await manager.stopAll();
    await new Promise((r) => setTimeout(r, 500));
    expect(readFileSync(join(dir, "starts"), "utf-8")).toBe("x");
  });

  it("reports a plugin that exited cleanly as down, and does not restart it", async () => {
    const dir = writePlugin(
      "done-plugin",
      `require("node:fs").appendFileSync("starts", "x"); process.exit(0);`
    );
    manager = makeManager([{ id: "s1", slug: "done-plugin", containerPort: 40128 }]);
    await manager.startAll();
    await until(() => manager!.pluginStatus()["done-plugin"] === "down");
    await new Promise((r) => setTimeout(r, 300));
    expect(readFileSync(join(dir, "starts"), "utf-8")).toBe("x");
  });

  it("reports an active plugin whose folder is missing as down", async () => {
    manager = makeManager([{ id: "s1", slug: "absent-plugin", containerPort: 40127 }]);
    await manager.startAll();
    expect(manager.pluginStatus()).toEqual({ "absent-plugin": "down" });
  });
});

describe("where plugins are loaded from", () => {
  it("is the folder under the home directory when nothing says otherwise", () => {
    expect(pluginsDirFrom({}, "/home/someone")).toEqual({
      dir: "/home/someone/.datatorag/plugins",
      fromImage: false,
    });
    expect(pluginsDirFrom({ DATATORAG_PLUGINS_DIR: "  " }, "/home/someone").fromImage).toBe(false);
  });

  it("is the image's own folder when the image names one", () => {
    expect(pluginsDirFrom({ DATATORAG_PLUGINS_DIR: "/app/plugins" }, "/home/someone")).toEqual({
      dir: "/app/plugins",
      fromImage: true,
    });
  });
});

describe("the account a plugin child runs as", () => {
  const passwd = [
    "root:x:0:0:root:/root:/bin/bash",
    "node:x:1000:1000::/home/node:/bin/bash",
    "plugin-gws-mcp:x:901:901::/nonexistent:/usr/sbin/nologin",
    "plugin-atlassian-mcp:x:902:902::/nonexistent:/usr/sbin/nologin",
    "plugin-as-root:x:0:0::/nonexistent:/usr/sbin/nologin",
    "plugin-root-group:x:903:0::/nonexistent:/usr/sbin/nologin",
    "plugin-broken:x:abc:904::/nonexistent:/usr/sbin/nologin",
  ].join("\n");

  it("is the plugin's own, one for each", () => {
    expect(pluginUserFrom(passwd, "gws-mcp")).toEqual({ uid: 901, gid: 901 });
    expect(pluginUserFrom(passwd, "atlassian-mcp")).toEqual({ uid: 902, gid: 902 });
  });

  it("is never root, whatever the account is called", () => {
    expect(pluginUserFrom(passwd, "as-root")).toBeNull();
    expect(pluginUserFrom(passwd, "root-group")).toBeNull();
  });

  it("is nobody when there is no such account or its line cannot be read", () => {
    expect(pluginUserFrom(passwd, "unknown-plugin")).toBeNull();
    expect(pluginUserFrom(passwd, "broken")).toBeNull();
    // A slug is matched whole against the account name, never as a prefix.
    expect(pluginUserFrom(passwd, "gws")).toBeNull();
  });

  // Writes who it runs as beside itself, then stays up until stopped.
  const dumpUser = `
    require("node:fs").writeFileSync("user.json", JSON.stringify({ uid: process.getuid(), gid: process.getgid(), groups: process.getgroups() }));
    setInterval(() => {}, 1000);
  `;

  it("leaves a plugin down when it should have an account and has none, and does not start it as the gateway", async () => {
    const dir = writePlugin("no-account-plugin", dumpUser);
    manager = makeManager(
      [{ id: "s1", slug: "no-account-plugin", containerPort: 40128 }],
      [],
      () => null
    );
    await manager.startAll();
    expect(manager.pluginStatus()).toEqual({ "no-account-plugin": "down" });
    await new Promise((r) => setTimeout(r, 300));
    expect(existsSync(join(dir, "user.json"))).toBe(false);
  });

  // The switch is real only in a real start. A test process that is not root
  // cannot become another user, so asking for one is refused by the
  // operating system: the plugin is down and never ran as us. The known-bad
  // form is a manager that drops the account: the child then starts as the
  // test's own user, writes its file, and this goes red. As root (some
  // containers) the child does start, and must be the account asked for.
  it("asks the operating system for that account when it starts the child", async () => {
    const other = { uid: 65534, gid: 65534 };
    const dir = writePlugin("other-user-plugin", dumpUser);
    chmodSync(dir, 0o777);
    manager = makeManager(
      [{ id: "s1", slug: "other-user-plugin", containerPort: 40129 }],
      [],
      () => other
    );
    await manager.startAll();

    if (process.getuid?.() === 0) {
      await until(() => existsSync(join(dir, "user.json")));
      const ran = JSON.parse(readFileSync(join(dir, "user.json"), "utf-8"));
      expect(ran.uid).toBe(other.uid);
      expect(ran.gid).toBe(other.gid);
      expect(ran.groups).not.toContain(0);
    } else {
      expect(manager.pluginStatus()).toEqual({ "other-user-plugin": "down" });
      await new Promise((r) => setTimeout(r, 300));
      expect(existsSync(join(dir, "user.json"))).toBe(false);
    }
  });

  it("starts a plugin as the gateway's own user when it is not the image's", async () => {
    const dir = writePlugin("same-user-plugin", dumpUser);
    manager = makeManager(
      [{ id: "s1", slug: "same-user-plugin", containerPort: 40130 }],
      [],
      () => undefined
    );
    await manager.startAll();
    await until(() => existsSync(join(dir, "user.json")));
    expect(JSON.parse(readFileSync(join(dir, "user.json"), "utf-8")).uid).toBe(process.getuid?.());
  });
});
