import { describe, expect, it } from "vitest";
import { DEMO_SCRIPTS, type DemoStep } from "./demo-scripts";

interface ToolPin {
  required: string[];
  allowed: string[];
  /** Writes must be gated. Reads must not be — the real gateway only asks
   * before a mutation, so a demo that gates a read would be selling a promise
   * the product doesn't make. */
  write: boolean;
}

/** Every service-backed tool the gateway serves also accepts `account`, which
 * the gateway injects into the plugin's own schema (see mcp-server.ts). It is
 * never in the connector source, so pin it here rather than in each list. */
function gws(pin: ToolPin): ToolPin {
  return { ...pin, allowed: [...pin.allowed, "account"] };
}

/** The real tools' input schemas, pinned by hand from the connector sources
 * (gws-mcp src/tools/{drive,sheets,slides,gmail}.ts). If one of these fails,
 * the TOOL changed — update the script (and this pin) to match the tool, never
 * the other way around. */
const REAL_TOOL_SCHEMAS: Record<string, ToolPin> = {
  "gws-mcp__drive_search": gws({
    required: ["query"],
    allowed: ["query", "page_size"],
    write: false,
  }),
  "gws-mcp__sheets_update": gws({
    required: ["spreadsheet_id", "range", "values"],
    allowed: ["spreadsheet_id", "range", "values", "parse_formulas"],
    write: true,
  }),
  "gws-mcp__slides_get": gws({
    required: ["presentation_id"],
    allowed: ["presentation_id"],
    write: false,
  }),
  "gws-mcp__slides_batch_update": gws({
    required: ["presentation_id", "requests"],
    allowed: ["presentation_id", "requests"],
    write: true,
  }),
  "gws-mcp__gmail_search": gws({
    required: ["query"],
    allowed: ["query", "max_results"],
    write: false,
  }),
  "gws-mcp__gmail_send": gws({
    required: ["to", "subject", "body"],
    allowed: ["to", "subject", "body", "cc", "bcc"],
    write: true,
  }),
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

/** Only what a viewer reads as prose — the assistant's and user's words, not
 * the tool payloads (where a word like "label" legitimately appears inside a
 * Gmail `labelIds` array). */
function scriptProse(steps: DemoStep[]): string {
  return steps
    .filter((s) => s.kind === "user" || s.kind === "assistant")
    .map((s) => ("text" in s ? s.text : ""))
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

  it("every write is gated, every read is not, at most one gate per script", () => {
    for (const script of DEMO_SCRIPTS) {
      for (const beat of toolBeats(script.steps)) {
        const gated = beat.kind === "approval";
        expect(
          gated,
          `${script.id}: ${beat.toolName} is ${
            REAL_TOOL_SCHEMAS[beat.toolName].write ? "a write" : "a read"
          } but renders ${gated ? "gated" : "ungated"}`
        ).toBe(REAL_TOOL_SCHEMAS[beat.toolName].write);
      }
      const approvals = script.steps.filter((s) => s.kind === "approval");
      expect(approvals.length, script.id).toBeLessThanOrEqual(1);
    }
  });

  it("a denied line exists on exactly the scripts that can be denied", () => {
    for (const script of DEMO_SCRIPTS) {
      const gated = script.steps.some((s) => s.kind === "approval");
      expect(Boolean(script.deniedText), script.id).toBe(gated);
    }
  });

  it("the two-account script calls one tool twice with different accounts", () => {
    const script = DEMO_SCRIPTS.find((s) => s.id === "accounts");
    expect(script).toBeDefined();
    const beats = toolBeats(script!.steps);
    expect(beats.length).toBe(2);
    expect(beats[0].toolName).toBe(beats[1].toolName);
    // The whole claim is the argument, so the argument is what gets pinned.
    const [a, b] = beats.map((beat) => beat.input.account);
    expect(a).toBeTruthy();
    expect(b).toBeTruthy();
    expect(a).not.toBe(b);
  });

  it("all invented data is visibly generic", () => {
    const everything = DEMO_SCRIPTS.map(
      (s) => scriptText(s.steps) + (s.deniedText ?? "")
    ).join(" ");
    // Emails only on example.com.
    for (const email of everything.match(/[\w.+-]+@[\w.-]+/g) ?? []) {
      expect(email.endsWith("@example.com"), email).toBe(true);
    }
  });

  it("no banned competitive framing anywhere in the scripts", () => {
    const prose = DEMO_SCRIPTS.map(
      (s) => scriptProse(s.steps) + (s.deniedText ?? "")
    )
      .join(" ")
      .toLowerCase();
    expect(prose).not.toContain("real write access");
    expect(prose).not.toContain("we write, they read");
    // Calendar and Gmail labels are things Claude's own connectors do have —
    // full calendar CRUD, and seven labelling tools. A demo beat that leans on
    // either would be claiming a gap that isn't there.
    expect(prose).not.toContain("calendar");
    expect(prose).not.toContain("label");
  });
});
