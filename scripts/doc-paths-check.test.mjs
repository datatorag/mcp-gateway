import { test } from "node:test";
import assert from "node:assert/strict";
import { docFiles, missingPaths, pathsIn } from "./doc-paths-check.mjs";

test("reads the skills, every README and every CLAUDE.md, and no dated record", () => {
  assert.deepEqual(
    docFiles([".claude/skills/deploy/SKILL.md", "README.md", "plugins/gws-mcp/CLAUDE.md", "docs/plans/x.md", ".claude/skills/deploy/notes.md"]),
    [".claude/skills/deploy/SKILL.md", "README.md", "plugins/gws-mcp/CLAUDE.md"]
  );
});

test("takes only tokens rooted at a top-level directory, expanding braces and dropping line refs", () => {
  const text = "see `apps/gateway/src/lib/{slack,brevo}.ts`, `scripts/gate.sh:142`, `lib/skills.ts`, `pnpm build`";
  assert.deepEqual(pathsIn(text).sort(), ["apps/gateway/src/lib/brevo.ts", "apps/gateway/src/lib/slack.ts", "scripts/gate.sh"]);
});

test("skips placeholders, globs and app routes written relative to the app directory", () => {
  const text = "`plugins/<slug>/README.md` `docs/plans/*.md` `docs/[slug]/page.tsx` `apps/gateway/src/app/docs/[slug]/page.tsx`";
  assert.deepEqual(pathsIn(text), ["apps/gateway/src/app/docs/[slug]/page.tsx"]);
});

test("names a path that is gone, and finds one that exists from the doc's own directory", () => {
  const tree = new Set(["apps/gateway/src/mastra/run-steps.ts", ".claude/skills/video/scripts/tts.mjs"]);
  const docs = [
    [".claude/skills/a/SKILL.md", "`apps/gateway/src/gateway/playground/engine.ts` and `apps/gateway/src/mastra/run-steps.ts`"],
    [".claude/skills/video/SKILL.md", "copy `scripts/tts.mjs`"],
    ["README.md", "the `tools/list` method"],
  ];
  assert.deepEqual(missingPaths(docs, (p) => tree.has(p)), [
    { file: ".claude/skills/a/SKILL.md", path: "apps/gateway/src/gateway/playground/engine.ts" },
  ]);
});
