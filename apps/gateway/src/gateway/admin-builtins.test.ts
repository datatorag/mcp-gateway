import { describe, expect, it } from "vitest";
import { BUILT_IN_TOOLS } from "./mcp-server";
import { ADMIN_ONLY_BUILTINS } from "./admin-builtins";

describe("the admin-only built-ins (SCRUM-431)", () => {
  it("are exactly the built-ins that declare an admin audience", () => {
    const declared = BUILT_IN_TOOLS.filter((t) => t.audience === "admin")
      .map((t) => t.definition.name)
      .sort();
    expect([...ADMIN_ONLY_BUILTINS].sort()).toEqual(declared);
    expect(declared.length).toBeGreaterThan(0);
  });
});
