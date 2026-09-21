/**
 * The hand-rolled scanner agrees with the TypeScript compiler (SCRUM-303).
 *
 * THIS TEST EXISTS BECAUSE A COMMENT CLAIMED IT ALREADY DID. The scanner's
 * docblock said the corpus was "checked by an AST walk", which was true of
 * a one-off measurement and false as a standing guarantee: nothing was
 * committed, and this repository has no CI, so nothing re-ran it. A claim
 * that something is checked has to be a check.
 *
 * It matters more than tidiness. The scanner is a regex-and-offsets reader
 * of TypeScript, which is a thing that cannot be done correctly in general,
 * and it has been wrong four times: line comments inside `covers`, block
 * comments, `//` inside a string, and shorthand properties, the last of
 * which hid 68 of 307 argument names. Each was found by someone reading it
 * rather than by the suite. This is the suite reading it.
 *
 * The compiler is the oracle because it shares none of the assumptions
 * that have actually broken: it has no regexes, no offsets and no opinion
 * about comments, which is where all four historical bugs lived.
 *
 * It does share three, and they bound what this proves: both readers walk
 * the same file list, both look for `ctx.call` with a string literal
 * first, and both skip a spread. A case moved out of this directory, or
 * called some other way, is invisible to both.
 *
 * What it does NOT assert is that the scanner is correct in general. It is
 * correct ON THIS CORPUS, and it goes red the day somebody writes a case
 * in a shape the scanner mishandles, which is the day it matters.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { CASES_DIR } from "./registry";
import { readCaseCalls, type CaseCall, isCaseFile } from "./case-arguments";

/** Every `ctx.call("tool", { ... })` the compiler can see, in source order. */
function readWithCompiler(dir: string): CaseCall[] {
  const found: CaseCall[] = [];

  for (const file of readdirSync(dir).filter(isCaseFile).sort()) {
    const source = ts.createSourceFile(
      file,
      readFileSync(join(dir, file), "utf8"),
      ts.ScriptTarget.Latest,
      true
    );

    const visit = (node: ts.Node): void => {
      if (
        ts.isCallExpression(node) &&
        ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) &&
        node.expression.expression.text === "ctx" &&
        node.expression.name.text === "call" &&
        node.arguments.length > 0 &&
        ts.isStringLiteral(node.arguments[0])
      ) {
        const tool = node.arguments[0].text;
        const second = node.arguments[1];
        if (second && ts.isObjectLiteralExpression(second)) {
          const args: string[] = [];
          for (const prop of second.properties) {
            // A spread names nothing, which is what the scanner does too.
            if (ts.isSpreadAssignment(prop)) continue;
            const name = prop.name;
            if (!name) continue;
            if (ts.isIdentifier(name)) args.push(name.text);
            else if (ts.isStringLiteral(name)) args.push(name.text);
            else if (ts.isNumericLiteral(name)) args.push(name.text);
            // A computed key is not a name either reader can state.
          }
          found.push({ file, tool, args });
        } else {
          found.push({ file, tool, args: null });
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }
  return found;
}

describe("readCaseCalls against the TypeScript compiler", () => {
  const scanner = readCaseCalls(CASES_DIR);
  const compiler = readWithCompiler(CASES_DIR);

  it("finds the same calls, in the same order", () => {
    expect(scanner.map((c) => `${c.file}:${c.tool}`)).toEqual(
      compiler.map((c) => `${c.file}:${c.tool}`)
    );
  });

  it("agrees about which calls it cannot read", () => {
    // A call the scanner gives up on is honest; one the COMPILER can read
    // and the scanner cannot is a blind spot that has entered the corpus.
    expect(scanner.filter((c) => c.args === null).map((c) => `${c.file}:${c.tool}`)).toEqual(
      compiler.filter((c) => c.args === null).map((c) => `${c.file}:${c.tool}`)
    );
  });

  it("reads the same argument names, in the same order, for every call", () => {
    /* THE ASSERTION THAT WOULD HAVE CAUGHT THE SHORTHAND GAP. 68 of 307
     * names were invisible and every test in this suite was green. */
    const mismatches = scanner
      .map((s, i) => ({ s, c: compiler[i] }))
      .filter(({ s, c }) => c && JSON.stringify(s.args) !== JSON.stringify(c.args))
      .map(({ s, c }) => `${s.file}:${s.tool} scanner=${JSON.stringify(s.args)} compiler=${JSON.stringify(c.args)}`);

    expect(mismatches, "the scanner and the compiler disagree about these calls").toEqual([]);
  });

  it("reads a corpus worth reading, so agreement is not agreement about nothing", () => {
    // Two empty readers agree perfectly. The floors are near the real
    // numbers rather than far below them.
    expect(compiler.length).toBeGreaterThan(120);
    expect(compiler.reduce((n, c) => n + (c.args?.length ?? 0), 0)).toBeGreaterThan(250);
  });
});
