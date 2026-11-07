import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/* The site's typefaces are files in the repository (src/app/fonts), so a
 * production build downloads nothing. next/font/google fetched them at build
 * time and failed the build whenever Google Fonts answered with a font URL it
 * could not parse. */

const SRC = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("fonts", () => {
  it("no source file loads a font from Google Fonts at build time", () => {
    const offenders = sourceFiles(SRC).filter((f) => readFileSync(f, "utf8").includes("next/font/google"));
    expect(offenders).toEqual([]);
  });

  it("every font file the layout names is in the repository, with its licence beside it", () => {
    const layout = readFileSync(join(__dirname, "layout.tsx"), "utf8");
    const files = [...layout.matchAll(/src: "\.\/(fonts\/[^"]+\.woff2)"/g)].map((m) => m[1]);
    expect(files).toHaveLength(3);
    for (const f of files) expect(statSync(join(__dirname, f)).size).toBeGreaterThan(0);
    for (const l of ["OFL-inter.txt", "OFL-montserrat.txt", "OFL-ptmono.txt"]) {
      expect(readFileSync(join(__dirname, "fonts", l), "utf8")).toContain("SIL Open Font License");
    }
  });
});
