import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { readPluginReadme } from "./plugin-readme";

describe("a plugin's README for its tool page (SCRUM-390)", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(path.join(tmpdir(), "plugin-readme-"));
    mkdirSync(path.join(dir, "plugins", "one"), { recursive: true });
    writeFileSync(path.join(dir, "plugins", "one", "README.md"), "# One\n");
    mkdirSync(path.join(dir, "plugins", "bare"), { recursive: true });
    writeFileSync(path.join(dir, "README.md"), "# Outside\n");
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it("reads the README beside the plugin's code", async () => {
    expect(await readPluginReadme(path.join(dir, "plugins"), "one")).toBe("# One\n");
  });

  it("is null for a plugin with no README, and for one that is not there", async () => {
    expect(await readPluginReadme(path.join(dir, "plugins"), "bare")).toBeNull();
    expect(await readPluginReadme(path.join(dir, "plugins"), "absent")).toBeNull();
  });

  it("never reads outside the plugins directory", async () => {
    // Control: the file a climbing slug would reach exists and is readable.
    expect(readFileSync(path.join(dir, "plugins", "..", "README.md"), "utf8")).toBe("# Outside\n");
    for (const slug of ["..", "one/..", "../plugins/one", "", "One", "one/"]) {
      expect(await readPluginReadme(path.join(dir, "plugins"), slug), JSON.stringify(slug)).toBeNull();
    }
  });
});

describe("where production's plugins live (SCRUM-390 close-out)", () => {
  const repo = path.resolve(process.cwd(), "../..");

  it("the tool page has one source for a README: no request to another host", () => {
    const page = readFileSync(
      path.join(repo, "apps/gateway/src/app/tools/[slug]/page.tsx"),
      "utf8"
    );
    expect(page).toContain("readPluginReadme(PLUGINS_DIR");
    expect(page).not.toMatch(/fetch\(/);
    expect(page).not.toContain("api.github.com");
    expect(page).not.toContain("homedir");
  });

  it("the production compose file mounts no volume", () => {
    const compose = readFileSync(path.join(repo, "docker/docker-compose.prod.yml"), "utf8");
    const code = compose
      .split("\n")
      .filter((line) => !line.trim().startsWith("#"))
      .join("\n");
    expect(code).not.toMatch(/^\s*volumes:/m);
    // Control: the filter keeps real keys, so the line above can fail.
    expect(code).toMatch(/^\s*memswap_limit:/m);
  });
});
