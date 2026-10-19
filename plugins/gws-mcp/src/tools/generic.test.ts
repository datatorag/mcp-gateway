import { afterEach, describe, expect, it, vi } from "vitest";
import { GwsClient } from "../gws-client.js";
import { handleGeneric } from "./generic.js";

afterEach(() => vi.restoreAllMocks());

/** gws_run with dry_run, through the real client and request builder: what
 * comes back is the request that would have been sent, and nothing is. */
async function dryRun(
  service: string,
  resource: string,
  method: string,
  params: Record<string, unknown>
): Promise<Array<[string, string]>> {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
  const client = new GwsClient({ accessToken: "test-token" });
  const out = await handleGeneric(client, "gws_run", { service, resource, method, params, dry_run: true });
  expect(spy).not.toHaveBeenCalled();
  return JSON.parse(out.content[0].text).query_params;
}

/* SCRUM-298. A caller that cannot send a real array sends the array as a JSON
 * string. The dedicated tools already accept that (SCRUM-269); gws_run's
 * params are a free-form object, so the same rule is applied here, only to
 * the params the method table declares repeated for that method. */
describe("gws_run: a JSON-string array for a repeated param is the array (SCRUM-298)", () => {
  it("sheets spreadsheets get: ranges as a JSON string goes out exactly as the real array does", async () => {
    const ranges = ["Sheet1!A1:B2", "Sheet2!A1"];
    const asArray = await dryRun("sheets", "spreadsheets", "get", { spreadsheetId: "s", ranges });
    const asString = await dryRun("sheets", "spreadsheets", "get", {
      spreadsheetId: "s",
      ranges: JSON.stringify(ranges),
    });

    expect(asArray).toEqual([
      ["ranges", "Sheet1!A1:B2"],
      ["ranges", "Sheet2!A1"],
    ]);
    expect(asString).toEqual(asArray);
  });

  it("gmail users.messages get: metadataHeaders as a JSON string goes out as repeated keys", async () => {
    const base = { userId: "me", id: "m", format: "metadata" };
    const asArray = await dryRun("gmail", "users.messages", "get", { ...base, metadataHeaders: ["From", "Subject"] });
    const asString = await dryRun("gmail", "users.messages", "get", {
      ...base,
      metadataHeaders: '["From","Subject"]',
    });

    expect(asArray.filter(([k]) => k === "metadataHeaders")).toEqual([
      ["metadataHeaders", "From"],
      ["metadataHeaders", "Subject"],
    ]);
    expect(asString).toEqual(asArray);
  });

  it("a param that is not repeated for the method keeps a string that looks like a JSON array", async () => {
    const q = '["not","an","array"]';
    const sent = await dryRun("drive", "files", "list", { q });
    expect(sent).toEqual([["q", q]]);
  });

  it("a string that is not a JSON array stays one value, even for a repeated param", async () => {
    const sent = await dryRun("sheets", "spreadsheets", "get", { spreadsheetId: "s", ranges: "Sheet1!A1:B2" });
    expect(sent).toEqual([["ranges", "Sheet1!A1:B2"]]);
  });

  it("a JSON string holding objects is refused by the existing rule, not sent", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("{}", { status: 200 }));
    const client = new GwsClient({ accessToken: "test-token" });
    const err = await handleGeneric(client, "gws_run", {
      service: "sheets",
      resource: "spreadsheets",
      method: "get",
      params: { spreadsheetId: "s", ranges: '[{"sheet":"A","range":"A1"}]' },
    }).catch((e: Error) => e);

    expect(spy).not.toHaveBeenCalled();
    expect((err as Error).message).toContain('"ranges"');
    expect((err as Error).message).toMatch(/nested arrays or objects/);
  });

  it("does not change the caller's params object", async () => {
    const params = { spreadsheetId: "s", ranges: '["A!A1"]' };
    await dryRun("sheets", "spreadsheets", "get", params);
    expect(params.ranges).toBe('["A!A1"]');
  });
});
