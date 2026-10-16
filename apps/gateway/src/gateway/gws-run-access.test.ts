import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Database } from "@datatorag-mcp/db";
import { PgDialect } from "drizzle-orm/pg-core";

const resolveUserEmail = vi.fn();
vi.mock("./user-email", () => ({
  resolveUserEmail: (...args: unknown[]) => resolveUserEmail(...args),
}));

import {
  GWS_RUN_REFUSAL,
  GWS_RUN_TOOL,
  gwsRunAllowedFor,
  gwsRunHiddenFrom,
  publiclyListedTool,
} from "./gws-run-access";

const db = {} as Database;

/* SCRUM-419, part 3: gws_run is listed and callable only for the login
 * emails in GWS_RUN_ALLOWED_ACCOUNTS. */
describe("gws_run allowlist", () => {
  beforeEach(() => {
    resolveUserEmail.mockReset();
    delete process.env.GWS_RUN_ALLOWED_ACCOUNTS;
  });
  afterEach(() => {
    delete process.env.GWS_RUN_ALLOWED_ACCOUNTS;
  });

  it("allows exactly the listed emails, without regard to case or spacing", () => {
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = " One@Example.com, two@example.com ,";
    expect(gwsRunAllowedFor("one@example.com")).toBe(true);
    expect(gwsRunAllowedFor("TWO@example.com")).toBe(true);
    expect(gwsRunAllowedFor("three@example.com")).toBe(false);
    // A listed email inside a longer one is not that email.
    expect(gwsRunAllowedFor("xone@example.com")).toBe(false);
    expect(gwsRunAllowedFor("one@example.com.evil")).toBe(false);
  });

  it("an empty or unset variable allows nobody", () => {
    expect(gwsRunAllowedFor("one@example.com")).toBe(false);
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "";
    expect(gwsRunAllowedFor("one@example.com")).toBe(false);
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = " , ,";
    expect(gwsRunAllowedFor("one@example.com")).toBe(false);
    // An empty email never matches an empty entry.
    expect(gwsRunAllowedFor("")).toBe(false);
  });

  it("an unknown email is refused: a failed lookup hides the tool", () => {
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "one@example.com";
    expect(gwsRunAllowedFor(null)).toBe(false);
    expect(gwsRunAllowedFor(undefined)).toBe(false);
  });

  it("hides gws_run from an account that is not listed, and only gws_run", async () => {
    process.env.GWS_RUN_ALLOWED_ACCOUNTS = "one@example.com";
    resolveUserEmail.mockResolvedValue("other@example.com");
    expect(await gwsRunHiddenFrom(db, "u", GWS_RUN_TOOL)).toBe(true);
    expect(await gwsRunHiddenFrom(db, "u", "gws-mcp__gmail_search")).toBe(false);

    resolveUserEmail.mockResolvedValue("one@example.com");
    expect(await gwsRunHiddenFrom(db, "u", GWS_RUN_TOOL)).toBe(false);

    resolveUserEmail.mockResolvedValue(null);
    expect(await gwsRunHiddenFrom(db, "u", GWS_RUN_TOOL)).toBe(true);
  });

  it("looks up no email for any other tool", async () => {
    await gwsRunHiddenFrom(db, "u", "gws-mcp__drive_search");
    expect(resolveUserEmail).not.toHaveBeenCalled();
  });

  it("the refusal names the dedicated tool families and nothing about the list", () => {
    expect(GWS_RUN_REFUSAL).toBe(
      "gws_run is not available on this account; use the gmail_, calendar_, drive_, sheets_, docs_ or tasks_ tools."
    );
    expect(GWS_RUN_REFUSAL).not.toMatch(/@|allow/i);
  });

  it("the public filter excludes gws_run by its namespaced name", () => {
    const { sql, params } = new PgDialect().sqlToQuery(publiclyListedTool());
    expect(sql).toMatch(/"namespaced_name" not in \(\$1\)/);
    expect(params).toEqual([GWS_RUN_TOOL]);
  });
});
