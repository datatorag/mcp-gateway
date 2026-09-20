/**
 * Reading a plugin's sha off disk (SCRUM-303), against fixture repositories
 * in every shape a real checkout takes. A reader only ever pointed at one
 * real repo passes whichever shape that repo happens to be in today.
 */

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGitSha, readPluginShas } from "./plugin-sha";

const SHA = "0123456789abcdef0123456789abcdef01234567";
const OTHER = "fedcba9876543210fedcba9876543210fedcba98";
const made: string[] = [];

function repo(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "plugin-sha-"));
  made.push(root);
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

afterEach(() => {
  while (made.length) rmSync(made.pop()!, { recursive: true, force: true });
});

describe("readGitSha", () => {
  it("reads a detached HEAD, which is what a deploy by sha leaves behind", () => {
    expect(readGitSha(repo({ ".git/HEAD": `${SHA}\n` }))).toBe(SHA);
  });

  it("follows a branch ref to its loose file", () => {
    const dir = repo({
      ".git/HEAD": "ref: refs/heads/main\n",
      ".git/refs/heads/main": `${SHA}\n`,
    });
    expect(readGitSha(dir)).toBe(SHA);
  });

  it("falls back to packed-refs when the loose file is gone", () => {
    const dir = repo({
      ".git/HEAD": "ref: refs/heads/main\n",
      ".git/packed-refs": `# pack-refs with: peeled fully-peeled sorted\n${OTHER} refs/heads/other\n${SHA} refs/heads/main\n`,
    });
    expect(readGitSha(dir)).toBe(SHA);
  });

  it("does not read a tag's peel line as the ref's own sha", () => {
    // `^<sha>` lines follow an annotated tag and name the commit it points
    // at. Treating one as a ref would silently report the wrong commit,
    // which is the failure this whole module refuses to risk.
    const dir = repo({
      ".git/HEAD": "ref: refs/heads/main\n",
      ".git/packed-refs": `${OTHER} refs/tags/v1\n^${SHA}\n${SHA} refs/heads/main\n`,
    });
    expect(readGitSha(dir)).toBe(SHA);
  });

  it.each([
    ["no .git at all", {}],
    ["a HEAD naming a ref that exists nowhere", { ".git/HEAD": "ref: refs/heads/ghost\n" }],
    ["a HEAD holding something that is not a sha", { ".git/HEAD": "not-a-sha\n" }],
    ["a truncated sha", { ".git/HEAD": "0123456\n" }],
    ["a loose ref holding rubbish", { ".git/HEAD": "ref: refs/heads/main\n", ".git/refs/heads/main": "corrupt\n" }],
  ])("gives null for %s, never a guess", (_label, files) => {
    expect(readGitSha(repo(files as Record<string, string>))).toBeNull();
  });

  it("refuses a ref that tries to climb out of the repo", () => {
    expect(readGitSha(repo({ ".git/HEAD": "ref: ../../../../etc/passwd\n" }))).toBeNull();
  });
});

describe("readPluginShas", () => {
  it("reports one entry per slug, null for a plugin that is not checked out", () => {
    const root = mkdtempSync(join(tmpdir(), "plugins-"));
    made.push(root);
    mkdirSync(join(root, "gws-mcp", ".git"), { recursive: true });
    writeFileSync(join(root, "gws-mcp", ".git", "HEAD"), `${SHA}\n`);

    expect(readPluginShas(root, ["gws-mcp", "atlassian-mcp"])).toEqual({
      "gws-mcp": SHA,
      "atlassian-mcp": null,
    });
  });
});
