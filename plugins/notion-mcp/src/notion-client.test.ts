import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOT_SHARED_MESSAGE,
  NOTION_VERSION,
  NotionApiError,
  NotionClient,
  RECONNECT_MESSAGE,
} from "./notion-client.js";
import { fakeFetch } from "./fixtures/fake-fetch.js";
import { recorded } from "./fixtures/load.js";
import { UNAUTHORIZED } from "./fixtures/errors-documented.js";

/* The real client against a stubbed fetch. What is pinned here is what we
 * SEND (URL, method, headers, body) and how Notion's refusals come back. */

const TOKEN = "fixture-bearer-not-a-real-token";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function caught(p: Promise<unknown>): Promise<NotionApiError> {
  try {
    await p;
  } catch (err) {
    return err as NotionApiError;
  }
  throw new Error("expected the call to throw");
}

describe("what the client sends", () => {
  it("a GET carries the bearer token and the pinned Notion-Version, and no body", async () => {
    const f = fakeFetch([{ status: 200, body: recorded("page").body }]);
    await new NotionClient({ accessToken: TOKEN }).get("/v1/pages/122f53f3-d53e-4072-842d-9891b983e4e0");
    expect(f.sent).toHaveLength(1);
    const [req] = f.sent;
    expect(req.method).toBe("GET");
    expect(req.url.href).toBe("https://api.notion.com/v1/pages/122f53f3-d53e-4072-842d-9891b983e4e0");
    expect(req.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(req.headers["Notion-Version"]).toBe("2026-03-11");
    expect(NOTION_VERSION).toBe("2026-03-11");
    expect(req.headers).not.toHaveProperty("Content-Type");
    expect(req.body).toBeUndefined();
  });

  it("a POST sends its body as JSON with a JSON content type", async () => {
    const f = fakeFetch([{ status: 200, body: recorded("search-empty").body }]);
    await new NotionClient({ accessToken: TOKEN }).post("/v1/search", { query: "x", page_size: 5 });
    expect(f.sent[0].method).toBe("POST");
    expect(f.sent[0].headers["Content-Type"]).toBe("application/json");
    expect(f.sent[0].headers["Notion-Version"]).toBe("2026-03-11");
    expect(f.sent[0].body).toEqual({ query: "x", page_size: 5 });
  });

  it("query values are encoded and undefined ones left out", async () => {
    const f = fakeFetch([{ status: 200, body: recorded("comments").body }]);
    await new NotionClient({ accessToken: TOKEN }).get("/v1/comments", { block_id: "a b", page_size: 10, start_cursor: undefined });
    expect(f.sent[0].url.search).toBe("?block_id=a+b&page_size=10");
  });

  it("refuses a call with no token, before any request", async () => {
    const f = fakeFetch([]);
    const err = await caught(new NotionClient().get("/v1/users/me"));
    expect(err.message).toMatch(/No Notion access token/);
    expect(err.message).toContain("list_connected_accounts");
    expect(f.sent).toHaveLength(0);
  });

  it("withToken keeps the token for the tool-scoped copy", async () => {
    const f = fakeFetch([{ status: 200, body: {} }]);
    await new NotionClient().withToken(TOKEN).forTool(true).get("/v1/users/me");
    expect(f.sent[0].headers.Authorization).toBe(`Bearer ${TOKEN}`);
  });
});

describe("Notion's refusals", () => {
  it("object_not_found is rewritten: not shared or not there, and how to share", async () => {
    const nf = recorded("err-not-found");
    fakeFetch([{ status: nf.status, body: nf.body }]);
    const err = await caught(new NotionClient({ accessToken: TOKEN }).get(nf.request.path));
    expect(err).toBeInstanceOf(NotionApiError);
    expect(err.status).toBe(404);
    expect(err.code).toBe("object_not_found");
    expect(err.message).toContain(NOT_SHARED_MESSAGE);
    expect(err.message).toMatch(/not shared with the DataToRAG connection/);
    expect(err.message).toMatch(/does not exist/);
    expect(err.message).toMatch(/••• menu.*Connections/);
    expect(err.message).toMatch(/parent page also shares every page under it/);
    // Notion's own advice names its integration and an internal id; neither
    // is passed on.
    expect(err.message).not.toContain("integration_id");
  });

  it("a 404 with another code is not dressed up as a sharing problem", async () => {
    fakeFetch([{ status: 404, body: { object: "error", status: 404, code: "something_else", message: "x" } }]);
    const err = await caught(new NotionClient({ accessToken: TOKEN }).get("/v1/pages/x"));
    expect(err.message).not.toContain(NOT_SHARED_MESSAGE);
    expect(err.message).toBe("Notion answered 404 something_else: x");
  });

  it("401 unauthorized says the connection needs reconnecting and names list_connected_accounts", async () => {
    fakeFetch([{ status: 401, body: UNAUTHORIZED }]);
    const err = await caught(new NotionClient({ accessToken: TOKEN }).get("/v1/users/me"));
    expect(err.status).toBe(401);
    expect(err.code).toBe("unauthorized");
    expect(err.message).toContain(RECONNECT_MESSAGE);
    expect(err.message).toContain("list_connected_accounts");
    expect(err.message).toMatch(/reconnect/);
  });

  it("any other envelope is thrown with its status, code and message", async () => {
    const v = recorded("err-validation");
    fakeFetch([{ status: v.status, body: v.body }]);
    const err = await caught(new NotionClient({ accessToken: TOKEN }).post(v.request.path, v.request.body));
    expect(err.status).toBe(400);
    expect(err.code).toBe("validation_error");
    expect(err.message).toBe("Notion answered 400 validation_error: Could not find property with name or id: NoSuchProperty");
  });

  it("a body that is not Notion's envelope is reported as text, with no code", async () => {
    fakeFetch([{ status: 502, body: "<html>Bad gateway</html>" }]);
    const err = await caught(new NotionClient({ accessToken: TOKEN }).get("/v1/users"));
    expect(err.status).toBe(502);
    expect(err.code).toBeUndefined();
    expect(err.message).toBe("Notion answered 502: <html>Bad gateway</html>");
  });
});
