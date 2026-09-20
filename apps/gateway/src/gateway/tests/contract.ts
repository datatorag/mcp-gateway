import Ajv from "ajv";
import type { ToolResult } from "./types";

/**
 * The contract check (SCRUM-303): what is true of every served tool, whether
 * or not a case exercises it.
 *
 * 1. It is served, and a plugin tool has an enabled registry row.
 * 2. Its input schema compiles as JSON Schema and declares an object.
 * 3. READ TOOLS ONLY: called with `{}`, a tool with a required property must
 *    answer with a validation error.
 *
 * Step 3 is restricted to reads by ruling, and the reason is worth keeping
 * next to the code: `required` is a declaration in a schema, not proof that
 * the handler validates before it acts. A write handler that reads an
 * optional default and proceeds on `{}` would be discovered by the probe
 * DOING it, and the plugin is about to be rewritten four times.
 *
 * Read or write comes from the same classifier the agent's approval gate
 * uses, which FAILS CLOSED: a tool nobody has classified counts as a write
 * and is not probed.
 */

export type ContractOutcome = {
  tool: string;
  status: "pass" | "fail";
  steps: string[];
  evidence: string[];
};

export type ContractSubject = {
  name: string;
  schema: Record<string, unknown> | undefined;
  /** False for a plugin tool whose registry row is missing or disabled. */
  registryEnabled: boolean;
  /** As the shared classifier sees it. Unknown counts as a write. */
  isRead: boolean;
};

export type ProbeFn = (tool: string) => Promise<ToolResult>;

const ajv = new Ajv({ strict: false, allErrors: false });

function requiredProps(schema: Record<string, unknown>): string[] {
  const required = schema.required;
  return Array.isArray(required) ? required.filter((r): r is string => typeof r === "string") : [];
}

export async function checkContract(
  subject: ContractSubject,
  probe: ProbeFn
): Promise<ContractOutcome> {
  const steps: string[] = [];
  const evidence: string[] = [];
  const fail = (line: string): ContractOutcome => {
    evidence.push(line);
    return { tool: subject.name, status: "fail", steps, evidence };
  };

  steps.push("served");
  if (!subject.registryEnabled) {
    return fail("served by the gateway but its registry row is missing or disabled");
  }

  steps.push("schema");
  const schema = subject.schema;
  if (!schema || typeof schema !== "object") return fail("has no input schema");
  if (schema.type !== "object") {
    return fail(`input schema declares type ${JSON.stringify(schema.type)}, not "object"`);
  }
  try {
    ajv.compile(schema);
  } catch (err) {
    return fail(`input schema does not compile: ${err instanceof Error ? err.message : String(err)}`);
  }

  const required = requiredProps(schema);
  if (!subject.isRead) {
    evidence.push("write tool: schema checked, never called");
    return { tool: subject.name, status: "pass", steps, evidence };
  }
  if (required.length === 0) {
    evidence.push("read tool with no required property: schema checked, never called");
    return { tool: subject.name, status: "pass", steps, evidence };
  }

  steps.push("empty-args probe");
  let result: ToolResult;
  try {
    result = await probe(subject.name);
  } catch (err) {
    return fail(`probing with {} threw instead of answering: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!result.isError) {
    return fail(`probing with {} succeeded, though the schema requires ${required.join(", ")}`);
  }
  const text = result.content.map((c) => c.text ?? "").join(" ").toLowerCase();
  const namesAMissingArgument =
    required.some((name) => text.includes(name.toLowerCase())) ||
    /required|missing|invalid|must (be|have)|expected/.test(text);
  if (!namesAMissingArgument) {
    return fail("probing with {} errored, but the message does not read as a validation refusal");
  }

  evidence.push(`probed with {}: refused, naming a missing argument`);
  return { tool: subject.name, status: "pass", steps, evidence };
}
