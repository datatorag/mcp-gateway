/**
 * No plugin call leaves the runner without a mapped account (SCRUM-303).
 *
 * A plugin call that reaches the gateway with no `account` runs as the
 * DEFAULT connected account, and on the machine this suite runs on that is
 * a real person's. `accountArgs` in `execute.ts` refuses such a call at run
 * time. This file holds the two things a run-time refusal cannot:
 *
 *  1. that every plugin call in the runner goes THROUGH `accountArgs`. A
 *     new `client.callTool` written beside it would skip the refusal and
 *     nothing at run time would notice;
 *  2. that every case calls each plugin tool as a role that plugin accepts
 *     and that the case declared. A mismatch is caught at run time too, but
 *     only in the middle of a live run, as a red that reads like a product
 *     failure.
 *
 * The compiler reads the source, not a regex, for the reasons in
 * `case-arguments.ast.test.ts`.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { CASES_DIR } from "./registry";
import { isCaseFile } from "./case-arguments";
import { PLUGIN_ROLES } from "./execute";

const RUNNER_DIR = join(CASES_DIR, "..");

const parse = (path: string) =>
  ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);

const walk = (node: ts.Node, visit: (n: ts.Node) => void): void => {
  visit(node);
  ts.forEachChild(node, (child) => walk(child, visit));
};

const isMethodCall = (node: ts.Node, method: string): node is ts.CallExpression =>
  ts.isCallExpression(node) &&
  ts.isPropertyAccessExpression(node.expression) &&
  node.expression.name.text === method;

const isAccountArgs = (node: ts.Node): boolean =>
  ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "accountArgs";

/** An identifier whose ONE declaration in the file is `const x =
 * accountArgs(...)`, which is how dispatch hands the guard and the client
 * the same object. A name declared twice is not accepted: the walk cannot
 * tell which one is in scope. */
const isBoundToAccountArgs = (source: ts.SourceFile, node: ts.Node): boolean => {
  if (!ts.isIdentifier(node)) return false;
  const declarations: ts.VariableDeclaration[] = [];
  walk(source, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === node.text) declarations.push(n);
  });
  return (
    declarations.length === 1 &&
    declarations[0].initializer !== undefined &&
    isAccountArgs(declarations[0].initializer) &&
    (declarations[0].parent.flags & ts.NodeFlags.Const) !== 0
  );
};

describe("every plugin call carries a mapped account", () => {
  it("routes every client.callTool in the runner through accountArgs", () => {
    const offenders: string[] = [];
    let seen = 0;
    const files = [
      ...readdirSync(RUNNER_DIR)
        .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
        .map((f) => join(RUNNER_DIR, f)),
      ...readdirSync(CASES_DIR).filter(isCaseFile).map((f) => join(CASES_DIR, f)),
    ];

    for (const path of files) {
      const source = parse(path);
      walk(source, (node) => {
        if (!isMethodCall(node, "callTool")) return;
        // The SDK adapter's one call takes a single `{ name, arguments }`
        // object; it is the transport underneath, not a dispatch site.
        if (node.arguments.length === 1 && ts.isObjectLiteralExpression(node.arguments[0])) return;
        seen += 1;
        const args = node.arguments[1];
        const routed = args !== undefined && (isAccountArgs(args) || isBoundToAccountArgs(source, args));
        if (!routed) {
          const { line } = source.getLineAndCharacterOfPosition(node.getStart());
          offenders.push(`${path.slice(RUNNER_DIR.length + 1)}:${line + 1}`);
        }
      });
    }

    expect(offenders).toEqual([]);
    // Dispatch, the two guard lookups and the contract probe. A count that
    // drops to zero would mean this walk stopped finding the sites at all.
    expect(seen).toBeGreaterThanOrEqual(4);
  });

  it("walks the whole runner tree, so a new directory is not a way round it", () => {
    // The walk above reads this directory and `cases/`. A third directory
    // would be invisible to it; this makes adding one a decision to extend
    // the walk rather than a gap.
    const dirs = readdirSync(RUNNER_DIR, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
    expect(dirs).toEqual(["cases"]);
  });

  it("calls each plugin tool as a role its plugin accepts and the case declared", () => {
    const offenders: string[] = [];
    let seen = 0;

    for (const file of readdirSync(CASES_DIR).filter(isCaseFile).sort()) {
      const source = parse(join(CASES_DIR, file));

      let declared: string[] | null = null;
      walk(source, (node) => {
        if (
          ts.isPropertyAssignment(node) &&
          ts.isIdentifier(node.name) &&
          node.name.text === "accounts" &&
          ts.isArrayLiteralExpression(node.initializer)
        ) {
          declared = node.initializer.elements.filter(ts.isStringLiteral).map((e) => e.text);
        }
      });

      walk(source, (node) => {
        if (
          !isMethodCall(node, "call") ||
          !ts.isIdentifier((node.expression as ts.PropertyAccessExpression).expression) ||
          ((node.expression as ts.PropertyAccessExpression).expression as ts.Identifier).text !== "ctx"
        ) {
          return;
        }
        const { line } = source.getLineAndCharacterOfPosition(node.getStart());
        const at = `${file}:${line + 1}`;
        const toolArg = node.arguments[0];
        if (!toolArg || !ts.isStringLiteral(toolArg)) {
          offenders.push(`${at}: tool name is not a literal, so its role cannot be checked`);
          return;
        }
        const tool = toolArg.text;
        if (!tool.includes("__")) return;
        seen += 1;

        let role = "sender";
        const opts = node.arguments[2];
        if (opts) {
          const as =
            ts.isObjectLiteralExpression(opts) &&
            opts.properties.find(
              (p): p is ts.PropertyAssignment =>
                ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "as"
            );
          if (!as || !ts.isStringLiteral(as.initializer)) {
            offenders.push(`${at}: ${tool} role is not a literal, so it cannot be checked`);
            return;
          }
          role = as.initializer.text;
        }

        const slug = tool.slice(0, tool.indexOf("__"));
        const allowed = PLUGIN_ROLES[slug] ?? [];
        if (!allowed.includes(role as never)) offenders.push(`${at}: ${tool} as ${role}`);
        if (!declared || !(declared as string[]).includes(role)) {
          offenders.push(`${at}: ${tool} as ${role}, which the case does not declare`);
        }
      });
    }

    expect(offenders).toEqual([]);
    expect(seen).toBeGreaterThan(100);
  });
});
