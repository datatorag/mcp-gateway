import { describe, expect, it } from "vitest";
import {
  AGENT_CAP_BODY,
  AGENT_CAP_PRIMARY_ACTION,
  AGENT_CAP_PRIMARY_HREF,
  AGENT_CAP_SECONDARY_ACTION,
  AGENT_CAP_SECONDARY_HREF,
  agentCapTitle,
} from "./agent-cap-copy";

const ALL = [
  agentCapTitle(25),
  AGENT_CAP_BODY,
  AGENT_CAP_PRIMARY_ACTION,
  AGENT_CAP_SECONDARY_ACTION,
];

describe("agent cap copy", () => {
  it("contains no em-dashes", () => {
    // The house rule, and the one worth a test because it is a fixed token: an
    // em-dash is present or it is not, no judgement needed. The previous
    // version of this panel had one, which is how a rule that lives only in a
    // skill file gets broken by the next person to touch the copy.
    for (const line of ALL) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("&mdash;");
    }
  });

  it("does not offer bring-your-own-key", () => {
    // BYOK is deferred to its own ticket because accepting someone's LLM key
    // is directly monetizable by whoever holds it, and that needs
    // credential-handling work first. Copy must not offer an exit that does
    // not exist. A match here is a candidate to check, not proof of a bug, but
    // there is no legitimate reason for these words to appear in this panel.
    for (const line of ALL) {
      expect(line.toLowerCase()).not.toMatch(/\b(byok|api key|your own key|bring your own)\b/);
    }
  });

  it("does not promise a checkout that has not shipped", () => {
    // Self-serve checkout is coming, and the upgrade exit is built for it. But
    // until it exists, a control saying "Buy" or "Upgrade now" asserts the
    // product can complete a transaction it cannot start. This bans the
    // TRANSACTION promise, not the idea of upgrading, so it does not need
    // rewriting when Stripe lands.
    for (const line of ALL) {
      expect(line.toLowerCase()).not.toMatch(/\b(buy|checkout|pay now|upgrade now|subscribe)\b/);
    }
  });

  it("routes the upgrade exit through the swappable seam", () => {
    // /upgrade is a route handler whose body Stripe replaces. Pointing this at
    // /pricing directly would spread the eventual swap across every call site,
    // and one of them would be missed.
    expect(AGENT_CAP_SECONDARY_HREF).toBe("/upgrade");
  });

  it("sends the config exit to a route, not to an id on one page", () => {
    // The regression this pins: the config exit used to scroll to
    // `#setup-wizard`, which exists only on /dashboard, so on the Agent route
    // the primary button did nothing. Asserting the href is a real path is what
    // stops a future change quietly re-coupling this panel to whatever page is
    // hosting it.
    expect(AGENT_CAP_PRIMARY_HREF).toMatch(/^\/[a-z0-9/-]+$/);
    expect(AGENT_CAP_PRIMARY_HREF).not.toContain("#");
  });

  it("calls the surface Agent, not playground", () => {
    // "Playground" is retired from user-facing text; it named a toy, and the
    // surface it names is becoming the front door.
    for (const line of ALL) {
      expect(line.toLowerCase()).not.toContain("playground");
    }
  });

  it("offers both exits", () => {
    // The hard stop is a real product state, so it has to leave somewhere to
    // go. One exit is a dead end wearing a message.
    expect(AGENT_CAP_BODY).toMatch(/MCP config/);
    expect(AGENT_CAP_SECONDARY_ACTION).toMatch(/runs/i);
  });

  it("states the cap it was given rather than a written-in number", () => {
    // The number must come from the value that refused the turn, or the panel
    // can disagree with the cap that produced it.
    expect(agentCapTitle(25)).toContain("25");
    expect(agentCapTitle(7)).toContain("7");
  });
});
