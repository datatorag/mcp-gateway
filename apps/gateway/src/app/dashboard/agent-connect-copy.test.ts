import { describe, expect, it } from "vitest";
import {
  ALL_CONNECT_COPY,
  CONNECT_ERROR_NOTICE,
  connectContinuationMessage,
} from "./agent-connect-copy";

describe("agent connect copy", () => {
  it("calls the surface Agent, not playground", () => {
    // Same rule as agent-composer-copy.test.ts, on the strings this surface
    // adds. A rule is only enforced on the strings a test can actually see.
    for (const line of ALL_CONNECT_COPY) {
      expect(line.toLowerCase()).not.toContain("playground");
    }
  });

  it("contains no em-dashes", () => {
    for (const line of ALL_CONNECT_COPY) {
      expect(line).not.toContain("—");
      expect(line).not.toContain("&mdash;");
    }
  });

  it("names the service the user just connected", () => {
    // The continuation is posted as the user, visibly. A generic "my account"
    // would read as odd from someone who connected a specific service two
    // seconds ago, and the service name is what lets the agent know which
    // tools just became available without another lookup.
    expect(connectContinuationMessage("Google Workspace")).toContain(
      "Google Workspace"
    );
  });

  it("points the error state back into the conversation, not to another page", () => {
    // Sending them elsewhere on failure would repeat the exact page-hop this
    // feature exists to remove.
    expect(CONNECT_ERROR_NOTICE.toLowerCase()).toContain("conversation");
    expect(CONNECT_ERROR_NOTICE).not.toContain("/dashboard");
  });

  it("keeps its own rules honest", () => {
    const bad = "try the playground — now";
    expect(bad.toLowerCase()).toContain("playground");
    expect(bad).toContain("—");
  });
});
