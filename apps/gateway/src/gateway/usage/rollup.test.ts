import { describe, it, expect } from "vitest";
import { buildRollupSql, buildPruneSql } from "./rollup";

describe("buildRollupSql", () => {
  it("inserts grouped rows for the target day", () => {
    const sql = buildRollupSql("2026-04-20");
    expect(sql).toContain("INSERT INTO usage_events_daily");
    expect(sql).toContain("2026-04-20");
    expect(sql).toContain("percentile_cont(0.5)");
    expect(sql).toContain("percentile_cont(0.95)");
    expect(sql).toContain("ON CONFLICT");
  });
});

describe("buildPruneSql", () => {
  it("deletes rows older than 90 days", () => {
    const sql = buildPruneSql();
    expect(sql).toMatch(/DELETE FROM usage_events/i);
    expect(sql).toContain("90 days");
  });
});
