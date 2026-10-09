import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { DEFAULT_SERVICES, scopesForServices } from "./gws-client.js";
import { allTools } from "./tools/index.js";

/**
 * `gmail.settings.basic` is not in our approved scope set.
 *
 * Requesting a scope that is not approved puts every user through Google's
 * unverified-app screen and caps how many accounts can connect at all, so the
 * cost of this regression is not a broken tool, it is onboarding.
 *
 * The filter write tools are the only reason we would want the scope, and
 * they stay withheld until it is approved.
 *
 * This is a test rather than a comment because a comment only protects code
 * that somebody reads. Any branch reintroducing either half fails here.
 *
 * It does NOT fail "on the way into main" — an earlier version of this comment
 * claimed that, and it was false. There is no CI in this repository: no
 * workflows, no hooks, nothing that runs on push, PR or merge. This suite runs
 * when a person or an agent types the command, so the guard protects a ritual
 * rather than a pipeline. Worth knowing before relying on it, and worth fixing
 * at the pipeline level rather than by trusting this sentence.
 */
const WITHHELD_SCOPE = "https://www.googleapis.com/auth/gmail.settings.basic";
const WITHHELD_TOOLS = ["gmail_create_filter", "gmail_delete_filter"];

describe("withheld until gmail.settings.basic is approved", () => {
  it("does not request the scope at consent time", () => {
    // The scope actually sent to Google. This is the one that triggers the
    // unverified-app screen, so it matters more than the manifest.
    expect(scopesForServices(DEFAULT_SERVICES)).not.toContain(WITHHELD_SCOPE);
  });

  it("does not declare the scope in the plugin manifest", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(process.cwd(), "datatorag.json"), "utf-8")
    ) as { oauth: { scopes: string[] } };
    expect(manifest.oauth.scopes).not.toContain(WITHHELD_SCOPE);
  });

  it("ships neither filter write tool", () => {
    // A tool that can only fail is worse than a missing one: it advertises a
    // capability, and the error arrives after someone relied on it.
    const names = allTools.map((tool) => tool.name);
    for (const withheld of WITHHELD_TOOLS) {
      expect(names).not.toContain(withheld);
    }
  });

  it("still ships the read half, which gmail.modify does cover", () => {
    // Guards that over-reach get deleted. This pins the boundary: listing
    // filters is unaffected and must not be collateral damage.
    expect(allTools.map((tool) => tool.name)).toContain("gmail_list_filters");
  });
});
