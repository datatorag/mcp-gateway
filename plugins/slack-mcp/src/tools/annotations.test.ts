import { describe, expect, it } from "vitest";
import { allTools, toolHandlers, toolReadOnly } from "./index.js";

const READS = [
  "slack_channels_list",
  "slack_messages_search",
  "slack_channel_history",
  "slack_thread_read",
  "slack_users_lookup",
  "slack_files_list",
];

/** Writes that notify people or replace what they read: destructive. */
const DESTRUCTIVE_WRITES = ["slack_message_update", "slack_message_post", "slack_dm_send"];

/** Writes that are small, reversible and notify no one: not destructive. */
const ADDITIVE_WRITES = ["slack_reactions_add"];

describe("the tool list", () => {
  it("serves exactly the reads and writes listed here, each with a handler", () => {
    expect(allTools.map((t) => t.name).sort()).toEqual([...READS, ...DESTRUCTIVE_WRITES, ...ADDITIVE_WRITES].sort());
    for (const t of allTools) expect(toolHandlers.has(t.name), t.name).toBe(true);
  });

  it("every read is annotated read-only and not destructive", () => {
    for (const name of READS) {
      const t = allTools.find((x) => x.name === name)!;
      expect(t.annotations, name).toMatchObject({ readOnlyHint: true, destructiveHint: false });
      expect(toolReadOnly.get(name), name).toBe(true);
    }
  });

  it("destructive writes carry destructiveHint true, the additive one false", () => {
    for (const name of DESTRUCTIVE_WRITES) expect(allTools.find((x) => x.name === name)!.annotations.destructiveHint, name).toBe(true);
    for (const name of ADDITIVE_WRITES) expect(allTools.find((x) => x.name === name)!.annotations.destructiveHint, name).toBe(false);
  });

  it("every write is not read-only, so it is never retried", () => {
    for (const name of [...DESTRUCTIVE_WRITES, ...ADDITIVE_WRITES]) {
      const t = allTools.find((x) => x.name === name)!;
      expect(t.annotations.readOnlyHint, name).toBe(false);
      expect(toolReadOnly.get(name), name).toBe(false);
    }
  });

  it("every tool has a title", () => {
    for (const t of allTools) expect(t.annotations.title.length, t.name).toBeGreaterThan(0);
  });

  it("names are snake case with the service first", () => {
    for (const t of allTools) expect(t.name, t.name).toMatch(/^slack_[a-z]+(_[a-z]+)*$/);
  });
});
