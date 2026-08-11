import { describe, it, expect } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { mcpServers, tools as toolsTable, usageEvents } from "@datatorag-mcp/db";
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
 * before touching the snapshot. Editing "write" to "read" here to make a
 * failing test pass removes a real user's approval prompt.
 *
 * Note there is no CI in this repository: nothing runs this on push, PR or
 * merge. It fails only in front of whoever ran it, which is the person who
 * then has to decide honestly rather than conveniently.
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

  /** A withheld tool can hide in THREE places, and until now only two were
   * guarded. The plugin repo pins that the Gmail filter write tools are absent
   * from its code and from its OAuth manifest. This is the third: the registry
   * kept advertising both long after the plugin stopped shipping them, because
   * nothing re-synced it and nothing asserted it had been.
   *
   * They are withheld because writing a filter needs a scope we do not have,
   * so the tools can only ever fail. Advertising a tool that cannot work is
   * worse than not having it: it is a capability someone plans around, and the
   * error arrives after they have relied on it.
   *
   * Pinned both ways on purpose. A guard that over-reaches gets deleted by
   * whoever it blocks, so this also asserts the READ half stays — listing
   * filters is legitimately covered by the scope we do have, and it must not
   * become collateral damage the next time someone tidies this up. */
  it("does not advertise tools withheld for a scope we do not have", () => {
    const names = new Set(REGISTRY_CLASSIFICATION.map(([name]) => name));
    expect(names.has("gws-mcp__gmail_create_filter")).toBe(false);
    expect(names.has("gws-mcp__gmail_delete_filter")).toBe(false);
    expect(names.has("gws-mcp__gmail_list_filters")).toBe(true);
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
  /** How stale the connected database may be before its answers stop meaning
   * anything. Generous on purpose: a guard that reddens on a quiet weekend is
   * a guard someone deletes, and then there is no guard. Production writes a
   * usage row on every tool call and runs busy enough that a fortnight of
   * silence is itself worth looking at. */
  const MAX_FIXTURE_AGE_DAYS = 14;

  it("is pointed at a database that is actually current", async () => {
    // THE GROUND HAS TO BE CURRENT BEFORE IT CAN BE GROUND TRUTH.
    //
    // Everything below compares the snapshot against "the live registry". That
    // phrase is doing a lot of work: it is only live if DATABASE_URL points at
    // the database production actually uses. It did not. A dev branch, forked
    // from prod and then left alone, kept answering — and because the branch
    // and the snapshot had gone stale in the same direction, they agreed and
    // this suite passed. A tool shipped unregistered for weeks underneath a
    // green check written specifically to catch that.
    //
    // That is the two-derived-artifacts trap one layer out: the fixture became
    // a third derived artifact, and nothing compared IT to anything. So the
    // first assertion is about the fixture rather than the subject.
    const [latest] = await getDb()
      .select({ at: usageEvents.createdAt })
      .from(usageEvents)
      .orderBy(desc(usageEvents.createdAt))
      .limit(1);

    // An empty table is not "fresh, nothing happened". On a database this
    // suite is willing to trust it means the wrong database, and absence must
    // never read as a pass.
    expect(
      latest,
      "no usage events at all: this is not the production database, or it is an empty copy. " +
        "Point DATABASE_URL at the database production uses, or refresh the dev branch from it."
    ).toBeDefined();

    const ageDays = (Date.now() - new Date(latest!.at).getTime()) / 86_400_000;
    expect(
      ageDays,
      `the connected database's newest usage event is ${ageDays.toFixed(1)} days old. ` +
        `Anything this suite reports about "the live registry" is a statement about a stale copy, ` +
        `not about production. Refresh the dev branch from its parent, or point DATABASE_URL at ` +
        `production, then re-run. Do NOT edit the snapshot to make this suite green.`
    ).toBeLessThan(MAX_FIXTURE_AGE_DAYS);
  });

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
