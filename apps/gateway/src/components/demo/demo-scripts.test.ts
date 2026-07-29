import { describe, expect, it } from "vitest";
import { DEMO_SCRIPTS, type DemoStep } from "./demo-scripts";

/** The real tools' input schemas, pinned by hand from the connector sources
 * (gws-mcp src/tools/{drive,sheets,gmail}.ts, atlassian-mcp
 * src/tools/jira.ts). If one of these fails, the TOOL changed — update the
 * script (and this pin) to match the tool, never the other way around. */
const REAL_TOOL_SCHEMAS: Record<
  string,
  { required: string[]; allowed: string[] }
> = {
  "gws-mcp__drive_search": {
    required: ["query"],
    allowed: ["query", "page_size"],
  },
  "gws-mcp__sheets_append": {
    required: ["spreadsheet_id", "values"],
    allowed: ["spreadsheet_id", "values", "range"],
  },
  "gws-mcp__gmail_send": {
    required: ["to", "subject", "body"],
    allowed: ["to", "subject", "body", "cc", "bcc"],
  },
  "atlassian-mcp__jira_create_issue": {
    required: ["project_key", "summary"],
    allowed: [
      "project_key",
      "summary",
      "description",
      "issue_type",
      "additional_fields",
    ],
  },
};

function toolBeats(steps: DemoStep[]) {
  return steps.filter(
    (s): s is Extract<DemoStep, { kind: "tool" | "approval" }> =>
      s.kind === "tool" || s.kind === "approval"
  );
}

function scriptText(steps: DemoStep[]): string {
  return steps
    .map((s) => ("text" in s ? s.text : JSON.stringify(s)))
    .join(" ");
}

describe("demo scripts stay true to the real tools", () => {
  it.each(DEMO_SCRIPTS.map((s) => [s.id, s] as const))(
    "%s: every tool beat matches a real tool's schema",
    (_id, script) => {
      for (const beat of toolBeats(script.steps)) {
        const schema = REAL_TOOL_SCHEMAS[beat.toolName];
        expect(schema, `unknown tool ${beat.toolName}`).toBeDefined();
        const keys = Object.keys(beat.input);
        for (const req of schema.required) {
          expect(keys, `${beat.toolName} missing ${req}`).toContain(req);
        }
        for (const key of keys) {
          expect(schema.allowed, `${beat.toolName} bad arg ${key}`).toContain(
            key
          );
        }
      }
    }
  );

  it("every result uses the real jsonResponse envelope with valid JSON", () => {
    for (const script of DEMO_SCRIPTS) {
      for (const beat of toolBeats(script.steps)) {
        const output = beat.output as {
          content: { type: string; text: string }[];
        };
        expect(output.content).toHaveLength(1);
        expect(output.content[0].type).toBe("text");
        expect(() => JSON.parse(output.content[0].text)).not.toThrow();
      }
    }
  });

  it("every script has exactly one approval beat — the payoff", () => {
    for (const script of DEMO_SCRIPTS) {
      const approvals = script.steps.filter((s) => s.kind === "approval");
      expect(approvals, script.id).toHaveLength(1);
    }
  });

  it("all invented data is visibly generic", () => {
    const everything = DEMO_SCRIPTS.map((s) =>
      scriptText(s.steps) + s.deniedText
    ).join(" ");
    // Emails only on example.com; Atlassian sites only on example.atlassian.net.
    for (const email of everything.match(/[\w.+-]+@[\w.-]+/g) ?? []) {
      expect(email.endsWith("@example.com"), email).toBe(true);
    }
    for (const site of everything.match(/https:\/\/[\w-]+\.atlassian\.net/g) ??
      []) {
      expect(site).toBe("https://example.atlassian.net");
    }
  });

  it("no banned competitive framing anywhere in the scripts", () => {
    const everything = DEMO_SCRIPTS.map((s) =>
      scriptText(s.steps) + s.deniedText
    )
      .join(" ")
      .toLowerCase();
    expect(everything).not.toContain("real write access");
    expect(everything).not.toContain("we write, they read");
    expect(everything).not.toContain("calendar");
  });
});
