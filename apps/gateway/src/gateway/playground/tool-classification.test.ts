import { describe, it, expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { mcpServers, tools as toolsTable } from "@datatorag-mcp/db";
import { getDb } from "@/lib/db";
import { classifyWrite, KNOWN_READ_TOOLS } from "./tools";
import { REGISTRY_CLASSIFICATION } from "./registry-snapshot";

/**
 * The write gate decides whether a tool can touch a user's data without being
 * asked first, and it decides it from the tool's NAME. That is a defensible
 * design — names are ours, they are stable, and unlike an MCP annotation a
 * plugin server cannot forge one — and since the gate inverted to fail-closed
 * it has no silent failure mode left: a tool the classifier does not
 * positively recognise prompts for approval rather than running unasked.
 *
 * This file is the review record behind that. It is the classification of
 * every tool in the registry, written down, in the repository, as a thing a
 * human agreed to. A new tool does not slip past — it fails closed at runtime
 * and turns up here (and in KNOWN_READ_TOOLS, if a read), in a diff, where it
 * is a question someone has to answer rather than a silence.
 *
 * WHEN THIS FAILS, DO NOT JUST UPDATE IT. The failure is the point: read the
 * name, decide what the tool actually does, and if the classifier is wrong,
 * fix the classifier (an entry in KNOWN_READ_TOOLS or the escalation list)
 * before touching the snapshot. Editing "write" to "read" here to get CI
 * green removes a user's approval prompt.
 */


describe("registry write/read classification snapshot", () => {
  it("classifies every tool in the registry exactly as recorded", () => {
    const actual = REGISTRY_CLASSIFICATION.map(
      ([name]) => [name, classifyWrite(name) ? "write" : "read"] as const
    );
    // Compared as one whole rather than in a loop on purpose: a per-tool
    // assertion reports the first tool that moved, this reports all of them,
    // which is what you want when a change to the verb list ripples.
    expect(actual).toEqual(REGISTRY_CLASSIFICATION);
  });

  it("has no duplicate entries", () => {
    const names = REGISTRY_CLASSIFICATION.map(([name]) => name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("is sorted by name, so a new tool shows up as an insertion", () => {
    const names = REGISTRY_CLASSIFICATION.map(([name]) => name);
    expect(names).toEqual([...names].sort());
  });

  it("KNOWN_READ_TOOLS is exactly this snapshot's read set", () => {
    // The gate's allowlist and this review record must be the same list, or
    // one of them is lying: an entry only here would fail closed at runtime
    // despite its reviewed "read"; an entry only there would run unprompted
    // with no review record. Needs no database, so it runs everywhere.
    const snapshotReads = REGISTRY_CLASSIFICATION.filter(
      ([, classification]) => classification === "read"
    ).map(([name]) => name);
    expect([...KNOWN_READ_TOOLS].sort()).toEqual(snapshotReads);
  });
});

/**
 * The snapshot above is only worth having if it is kept honest against the
 * registry it claims to describe. This checks that, and needs a database, so
 * it runs wherever one is configured and reports as skipped where one is not —
 * the same posture as the e2e suite. A drift here is not cosmetic: a tool
 * missing from the snapshot is a tool nobody reviewed the gate decision for.
 */
describe.runIf(!!process.env.DATABASE_URL)("snapshot vs the live registry", () => {
  it("covers every enabled tool on an active server, and no tools that are gone", async () => {
    const rows = await getDb()
      .select({ namespacedName: toolsTable.namespacedName })
      .from(toolsTable)
      .innerJoin(mcpServers, eq(toolsTable.mcpServerId, mcpServers.id))
      .where(and(eq(mcpServers.status, "active"), eq(toolsTable.enabled, true)));

    const live = new Set(rows.map((row) => row.namespacedName));
    const recorded = new Set(REGISTRY_CLASSIFICATION.map(([name]) => name));

    // Named separately so the failure message says which way the drift went.
    const unreviewed = [...live].filter((name) => !recorded.has(name)).sort();
    const removed = [...recorded].filter((name) => !live.has(name)).sort();

    expect({ unreviewed, removed }).toEqual({ unreviewed: [], removed: [] });
  });

  /** The same safety taxonomy exists twice, in two repositories: this gate's
   * KNOWN_READ_TOOLS, and each plugin's own `readOnlyHint` annotations. Both
   * are hand-maintained, and they silently diverged — the plugins correctly
   * flipped `gws_auth_setup` to non-read (its "login" action starts an OAuth
   * flow and writes credentials) while this list still called it a read that
   * runs unprompted.
   *
   * This test is the fix; reconciling the entry was only its consequence. It
   * does NOT make the gate trust annotations — that trust was deliberately
   * removed, and `classifyWrite` still decides from the tool name alone. It
   * asserts the two independently-maintained records AGREE, so the next
   * divergence fails here in a diff instead of quietly widening what runs
   * without asking. */
  it("agrees with what the plugins themselves declare read-only", async () => {
    const rows = await getDb()
      .select({
        namespacedName: toolsTable.namespacedName,
        readOnlyHint: toolsTable.readOnlyHint,
      })
      .from(toolsTable)
      .innerJoin(mcpServers, eq(toolsTable.mcpServerId, mcpServers.id))
      .where(and(eq(mcpServers.status, "active"), eq(toolsTable.enabled, true)));

    // Unannotated tools (null) say nothing either way and are not evidence
    // of disagreement — only an explicit true/false is.
    const declaredRead = new Set(
      rows.filter((r) => r.readOnlyHint === true).map((r) => r.namespacedName)
    );
    const declaredNotRead = new Set(
      rows.filter((r) => r.readOnlyHint === false).map((r) => r.namespacedName)
    );

    // Declared read-only upstream, but the gate does not list it as a read:
    // harmless today (it prompts) but a sign the lists have drifted.
    const missingFromGate = [...declaredRead]
      .filter((name) => !KNOWN_READ_TOOLS.has(name))
      .sort();
    // The dangerous direction: the gate runs it unprompted while the plugin
    // that implements it says it is not read-only.
    const runsUnpromptedButNotRead = [...KNOWN_READ_TOOLS]
      .filter((name) => declaredNotRead.has(name))
      .sort();

    expect({ missingFromGate, runsUnpromptedButNotRead }).toEqual({
      missingFromGate: [],
      runsUnpromptedButNotRead: [],
    });
  });
});
