import { describe, expect, it } from "vitest";
import { argumentRefusalText, validateArguments } from "./argument-validation";

const addComment = {
  type: "object",
  properties: { issue_key: { type: "string" }, comment: { type: "string" } },
  required: ["issue_key", "comment"],
};

function refused(v: ReturnType<typeof validateArguments>) {
  if (v.ok) throw new Error("expected a refusal");
  return v;
}

describe("validateArguments", () => {
  it("passes exact arguments on a tool with no required", () => {
    const s = { type: "object", properties: { q: {} } };
    expect(validateArguments(s, { q: "x" })).toEqual({ ok: true });
    expect(validateArguments(s, {})).toEqual({ ok: true });
  });

  it("names one missing required argument", () => {
    const v = refused(validateArguments(addComment, { issue_key: "A-1" }));
    expect(v.missing).toEqual(["comment"]);
    expect(v.unknown).toEqual([]);
  });

  it("names every missing required argument on empty args", () => {
    const v = refused(validateArguments(addComment, {}));
    expect(v.missing).toEqual(["issue_key", "comment"]);
    const v2 = refused(validateArguments(addComment, undefined));
    expect(v2.missing).toEqual(["issue_key", "comment"]);
  });

  it("names one unknown argument", () => {
    const v = refused(
      validateArguments(addComment, { issue_key: "A-1", comment: "c", body: "b" }),
    );
    expect(v.unknown).toEqual(["body"]);
    expect(v.missing).toEqual([]);
  });

  it("names many unknown arguments", () => {
    const v = refused(
      validateArguments(addComment, { issue_key: "A-1", comment: "c", x: 1, y: 2 }),
    );
    expect(v.unknown).toEqual(["x", "y"]);
  });

  it("reports missing and unknown at once", () => {
    const v = refused(validateArguments(addComment, { issue_key: "A-1", body: "b" }));
    expect(v.missing).toEqual(["comment"]);
    expect(v.unknown).toEqual(["body"]);
  });

  it("allows account when listed as extra", () => {
    const args = { issue_key: "A-1", comment: "c", account: "a@example.com" };
    expect(validateArguments(addComment, args, ["account"])).toEqual({ ok: true });
    expect(refused(validateArguments(addComment, args)).unknown).toEqual(["account"]);
  });

  it("skips the unknown check when the schema has no properties", () => {
    expect(validateArguments({ type: "object", required: ["a"] }, { a: 1, zzz: 2 })).toEqual({
      ok: true,
    });
  });

  it("skips the unknown check when additionalProperties is true or an object", () => {
    expect(
      validateArguments({ ...addComment, additionalProperties: true }, { issue_key: "A", comment: "c", body: "b" }),
    ).toEqual({ ok: true });
    expect(
      validateArguments({ ...addComment, additionalProperties: { type: "string" } }, { issue_key: "A", comment: "c", body: "b" }),
    ).toEqual({ ok: true });
  });

  it("suggests a near miss and nothing for a distant name", () => {
    const near = refused(validateArguments(addComment, { issue_key: "A", commnet: "c" }));
    expect(near.suggestions).toEqual({ commnet: "comment" });
    const far = refused(validateArguments(addComment, { issue_key: "A", comment: "c", body: "b" }));
    expect(far.suggestions).toEqual({});
  });
});

describe("argumentRefusalText", () => {
  it("says unknown and required/missing and names the tool", () => {
    const v = refused(validateArguments(addComment, { commnet: "c" }));
    const text = argumentRefusalText("jira_add_comment", v, ["issue_key", "comment"]);
    expect(text).toBe(
      'jira_add_comment: unknown argument "commnet" (did you mean "comment"?); missing required arguments: issue_key, comment. Required: issue_key, comment. Nothing was sent.',
    );
    expect(text).toMatch(/unknown/);
    expect(text).toMatch(/required|missing/);
  });
});

describe("hardening", () => {
  it("treats a prototype name as unknown, not as declared", () => {
    const schema = { type: "object", properties: { a: {} }, required: [] };
    const v = validateArguments(schema, { constructor: 1, toString: 2, __proto__: 3 } as Record<string, unknown>);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.unknown.sort()).toEqual(["constructor", "toString"]);
  });

  it("echoes an unknown name without control characters and bounded", () => {
    const schema = { type: "object", properties: { a: {} }, required: [] };
    const long = "x".repeat(500) + "\u0007\u202e";
    const v = validateArguments(schema, { [long]: 1 });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    const text = argumentRefusalText("t", v, []);
    expect(text).not.toMatch(/[\u0007\u202e]/);
    expect(text.length).toBeLessThan(400);
  });
});
