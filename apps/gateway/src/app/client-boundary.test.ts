import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * No server component reads a VALUE out of a client module.
 *
 * A module that begins with "use client" is a boundary. A server component
 * may import a COMPONENT across it and render it. Anything else it imports
 * from there (a constant, a helper, a hook) is not the thing itself on the
 * server but a reference meant for the browser, and reading a property off
 * that reference gives undefined.
 *
 * Nothing catches it. It type-checks, it builds, and every test that renders
 * the component passes, because a test runner has no such boundary. It fails
 * only in a real server render, and only on the branch that touches the
 * value: the Billing page did it on the one branch a Pro account reaches,
 * and failed for every Pro user (SCRUM-406).
 *
 * So this walks the import graph the way the server does: from each route
 * entry that is not itself a client module, through every module that is
 * not, and stops at each client module it meets. What it checks there is the
 * list of names imported across. A capitalised name is taken to be a
 * component; a `type` import is erased; anything else is the defect.
 *
 * Its reach, stated: named imports only. A default import is taken to be a
 * component, a namespace import (`import * as x`) is not looked into, and a
 * capitalised constant passes as a component would.
 */

const SRC = resolve(__dirname, "..");
const EXTENSIONS = [".ts", ".tsx"];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return walk(path);
    return EXTENSIONS.some((ext) => name.endsWith(ext)) ? [path] : [];
  });
}

const sourceCache = new Map<string, string>();
const read = (path: string): string => {
  let text = sourceCache.get(path);
  if (text === undefined) {
    text = readFileSync(path, "utf8");
    sourceCache.set(path, text);
  }
  return text;
};

/** The directive has to be the first statement; comments may precede it. */
export function isClientModule(source: string): boolean {
  const withoutComments = source.replace(/^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/, "");
  return /^["']use client["']/.test(withoutComments);
}

function resolveImport(from: string, specifier: string): string | null {
  let base: string;
  if (specifier.startsWith("@/")) base = join(SRC, specifier.slice(2));
  else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
  else return null; // a package
  const candidates = [
    base,
    ...EXTENSIONS.map((ext) => base + ext),
    ...EXTENSIONS.map((ext) => join(base, `index${ext}`)),
  ];
  return candidates.find((path) => existsSync(path) && statSync(path).isFile()) ?? null;
}

interface Import {
  specifier: string;
  /** Value names imported by name; `type` imports are left out. */
  names: string[];
}

export function importsOf(source: string): Import[] {
  const found: Import[] = [];
  const statement = /import\s+(type\s+)?([^;'"]*?)\s*from\s*["']([^"']+)["']/g;
  for (const match of source.matchAll(statement)) {
    const [, typeOnly, clause, specifier] = match;
    if (typeOnly) continue;
    const braces = clause!.match(/\{([\s\S]*)\}/);
    const names = braces
      ? braces[1]!
          .split(",")
          .map((part) => part.trim())
          .filter((part) => part !== "" && !part.startsWith("type "))
          .map((part) => part.split(/\s+as\s+/)[0]!.trim())
      : [];
    found.push({ specifier: specifier!, names });
  }
  // A bare re-export or side-effect import still pulls the module in.
  for (const match of source.matchAll(/(?:import|export\s+\*\s+from|export\s+\{[^}]*\}\s+from)\s*["']([^"']+)["']/g)) {
    found.push({ specifier: match[1]!, names: [] });
  }
  return found;
}

const isComponentName = (name: string) => /^[A-Z][A-Za-z0-9]*$/.test(name) && /[a-z]/.test(name);

const ENTRY = /^(page|layout|route|not-found|error|loading|template|default|sitemap|robots|opengraph-image|icon)\.(ts|tsx)$/;

function crossings(): { offenders: string[]; serverModules: number; boundaries: number } {
  const entries = walk(join(SRC, "app")).filter(
    (path) => ENTRY.test(path.split("/").pop()!) && !isClientModule(read(path))
  );
  const seen = new Set<string>();
  const queue = [...entries];
  const offenders: string[] = [];
  let boundaries = 0;
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (seen.has(file)) continue;
    seen.add(file);
    for (const { specifier, names } of importsOf(read(file))) {
      const target = resolveImport(file, specifier);
      if (!target || /\.test\.(ts|tsx)$/.test(target)) continue;
      if (!isClientModule(read(target))) {
        queue.push(target);
        continue;
      }
      boundaries += 1;
      for (const name of names) {
        if (!isComponentName(name)) {
          offenders.push(`${relative(SRC, file)} reads ${name} from client module ${relative(SRC, target)}`);
        }
      }
    }
  }
  return { offenders: [...new Set(offenders)].sort(), serverModules: seen.size, boundaries };
}

describe("the server/client module boundary", () => {
  const result = crossings();

  it("walked a real graph, across real boundaries", () => {
    // If the walk found nothing to walk, the assertion below proves nothing.
    expect(result.serverModules).toBeGreaterThan(100);
    expect(result.boundaries).toBeGreaterThan(30);
  });

  it("no server-rendered module reads a value out of a client module", () => {
    expect(result.offenders).toEqual([]);
  });

  it("knows a client module by its directive, wherever comments put it", () => {
    expect(isClientModule('"use client";\nimport x from "y";')).toBe(true);
    expect(isClientModule("// note\n/* block */\n'use client'\n")).toBe(true);
    expect(isClientModule('import x from "y";\n"use client";')).toBe(false);
    expect(isClientModule('const s = "use client";')).toBe(false);
  });

  it("reads named value imports and leaves types out", () => {
    const [first] = importsOf(
      'import Default, { FreeCta, PRICE_LABEL, type Interval, useThing as useIt } from "./ctas";'
    );
    expect(first).toEqual({ specifier: "./ctas", names: ["FreeCta", "PRICE_LABEL", "useThing"] });
    expect(importsOf('import type { A } from "./a";').filter((i) => i.names.length > 0)).toEqual([]);
    expect(isComponentName("FreeCta")).toBe(true);
    expect(isComponentName("PRICE_LABEL")).toBe(false);
    expect(isComponentName("useThing")).toBe(false);
  });
});
