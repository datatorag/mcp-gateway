/**
 * The contract check (SCRUM-303). The load-bearing assertion in this file is
 * the NEGATIVE one: a write tool, and an unclassified tool, must never be
 * called. The probe is given a spy that fails the test if it runs.
 */

import { describe, expect, it, vi } from "vitest";
import { checkContract, type ContractSubject } from "./contract";

const readSchema = {
  type: "object",
  properties: { spreadsheet_id: { type: "string" } },
  required: ["spreadsheet_id"],
};

const subject = (over: Partial<ContractSubject> = {}): ContractSubject => ({
  name: "gws-mcp__sheets_read",
  schema: readSchema,
  registryEnabled: true,
  isRead: true,
  ...over,
});

const refuses = vi.fn().mockResolvedValue({
  content: [{ type: "text", text: "sheets_read: spreadsheet_id is required" }],
  isError: true,
});

describe("a read tool with a required property", () => {
  it("passes when {} is refused with a message naming the argument", async () => {
    const probe = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "spreadsheet_id is required" }],
      isError: true,
    });
    const out = await checkContract(subject(), probe);
    expect(out.status).toBe("pass");
    expect(out.steps).toContain("empty-args probe");
    expect(probe).toHaveBeenCalledOnce();
  });

  it("fails when {} SUCCEEDS, which is a handler acting on nothing", async () => {
    const probe = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "[]" }] });
    const out = await checkContract(subject(), probe);
    expect(out.status).toBe("fail");
    expect(out.evidence.join(" ")).toContain("succeeded");
  });

  it("fails when {} throws a protocol error instead of answering", async () => {
    const probe = vi.fn().mockRejectedValue(new Error("connection reset"));
    const out = await checkContract(subject(), probe);
    expect(out.status).toBe("fail");
    expect(out.evidence.join(" ")).toContain("threw");
  });

  it("fails when the error does not read as a validation refusal", async () => {
    // A 5xx-shaped message is an error, and it is not evidence that the
    // handler validated anything.
    const probe = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "upstream returned 503" }],
      isError: true,
    });
    const out = await checkContract(subject(), probe);
    expect(out.status).toBe("fail");
  });
});

describe("what must never be called", () => {
  const explodes = vi.fn(async () => {
    throw new Error("the contract check called a tool it must not call");
  });

  it("a WRITE tool is checked and never probed", async () => {
    const out = await checkContract(subject({ name: "gws-mcp__gmail_send", isRead: false }), explodes);
    expect(out.status).toBe("pass");
    expect(explodes).not.toHaveBeenCalled();
    expect(out.evidence.join(" ")).toContain("never called");
    expect(out.steps).not.toContain("empty-args probe");
  });

  it("a read tool with NO required property is checked and never probed", async () => {
    const out = await checkContract(
      subject({ schema: { type: "object", properties: {} } }),
      explodes
    );
    expect(out.status).toBe("pass");
    expect(explodes).not.toHaveBeenCalled();
    expect(out.evidence.join(" ")).toContain("no required property");
  });
});

describe("the first two steps", () => {
  it("fails a served tool whose registry row is missing or disabled", async () => {
    const out = await checkContract(subject({ registryEnabled: false }), refuses);
    expect(out.status).toBe("fail");
    expect(out.evidence.join(" ")).toContain("registry row");
  });

  it("fails a tool with no schema at all", async () => {
    const out = await checkContract(subject({ schema: undefined }), refuses);
    expect(out.status).toBe("fail");
  });

  it("fails a schema that is not an object type", async () => {
    const out = await checkContract(subject({ schema: { type: "string" } }), refuses);
    expect(out.evidence.join(" ")).toContain("not \"object\"");
  });

  it("fails a schema that does not compile", async () => {
    const out = await checkContract(
      subject({ schema: { type: "object", properties: { a: { type: "nonsense" } } } }),
      refuses
    );
    expect(out.status).toBe("fail");
    expect(out.evidence.join(" ")).toContain("does not compile");
  });

  it("records which steps ran, so a pass says what it actually checked", async () => {
    const out = await checkContract(subject({ isRead: false }), explodesNever);
    expect(out.steps).toEqual(["served", "schema"]);
  });
});

const explodesNever = vi.fn(async () => {
  throw new Error("must not be called");
});
