/**
 * What the vendored gws binary does with an array parameter (SCRUM-178).
 *
 * This is the half no fake client can pin. The binary builds the URL, so
 * the only evidence about repeated query keys is the binary's own
 * `--dry-run` output, which prints the request it would send without
 * sending it. An earlier guard in gws-client.ts asserted, from memory,
 * that the binary flattened `ranges: ["A", "B"]` into one literal value;
 * it does not, and the guard blocked every such call until a customer hit
 * it. A claim about the binary is checked against the binary here.
 *
 * Skipped, not failed, when the binary for this platform is not in bin/:
 * download-binaries.sh fetches it during `build`, and a checkout that has
 * not built yet has nothing to measure.
 */
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CliTransport } from "./cli-transport.js";

const binDir = path.resolve(__dirname, "..", "bin");
const binaryFor: Record<string, string> = {
  "darwin-arm64": path.join(binDir, "gws-aarch64-apple-darwin", "gws"),
  "darwin-x64": path.join(binDir, "gws-x86_64-apple-darwin", "gws"),
  "linux-x64": path.join(binDir, "gws-x86_64-unknown-linux-gnu", "gws"),
  "win32-x64": path.join(binDir, "gws.exe"),
};
const binary = binaryFor[`${process.platform}-${process.arch}`];
const haveBinary = binary !== undefined && existsSync(binary);

interface DryRun {
  dry_run: boolean;
  method: string;
  url: string;
  query_params: [string, string][];
}

function pairsFor(run: DryRun, key: string): string[] {
  return run.query_params.filter(([k]) => k === key).map(([, v]) => v);
}

describe.skipIf(!haveBinary)("the pinned gws binary sends a scalar array as a repeated query key", () => {
  let configDir = "";
  let client: CliTransport;

  beforeAll(() => {
    // A private config dir so the binary neither reads nor writes the
    // machine's real one; --dry-run never contacts Google, and the token
    // is a placeholder the request is built around, not sent anywhere.
    configDir = mkdtempSync(path.join(os.tmpdir(), "gws-transport-"));
    // Since SCRUM-289 a token-bearing GwsClient never reaches the binary, so
    // the fallback transport is driven directly here. The oracle test holds
    // the NEW client against this same binary for every method.
    client = new CliTransport({
      ...process.env,
      GOOGLE_WORKSPACE_CLI_CONFIG_DIR: configDir,
      GOOGLE_WORKSPACE_CLI_TOKEN: "dry-run-placeholder",
    });
  });
  afterAll(() => {
    if (configDir) rmSync(configDir, { recursive: true, force: true });
  });

  it.each([
    ["sheets", "spreadsheets", "get", { spreadsheetId: "s", ranges: ["Sheet1!A1:B2", "Sheet1!C1:D2"] }, "ranges"],
    ["gmail", "users.messages", "get", { userId: "me", id: "m", format: "metadata", metadataHeaders: ["From", "Subject"] }, "metadataHeaders"],
    ["gmail", "users.messages", "list", { userId: "me", labelIds: ["INBOX", "UNREAD"] }, "labelIds"],
  ])("%s %s %s: one pair per element", async (service, resource, method, params, key) => {
    // The first call for a service fetches its discovery document (a public
    // JSON file, no token involved) into the private config dir; a few
    // seconds cold, instant after. Nothing here reaches a Google API.
    const result = await client.api(service, resource, method, { params, dryRun: true });
    const run = result.data as DryRun;

    expect(run.dry_run).toBe(true);
    expect(run.method).toBe("GET");
    // The pairs, in order, exactly the elements given: not one pair holding
    // a JSON array, and not a comma-joined value.
    expect(pairsFor(run, key)).toEqual(params[key as keyof typeof params]);
    expect(run.query_params.map(([k]) => k)).not.toContain(`${key}[]`);
  }, 30_000);

  it("keeps scalar params as single pairs beside the repeated one", async () => {
    const result = await client.api("gmail", "users.messages", "list", {
      params: { userId: "me", labelIds: ["INBOX"], q: "is:unread", maxResults: 5 },
      dryRun: true,
    });
    const run = result.data as DryRun;
    expect(pairsFor(run, "q")).toEqual(["is:unread"]);
    expect(pairsFor(run, "maxResults")).toEqual(["5"]);
    expect(run.url).toBe("https://gmail.googleapis.com/gmail/v1/users/me/messages");
  }, 30_000);
});
