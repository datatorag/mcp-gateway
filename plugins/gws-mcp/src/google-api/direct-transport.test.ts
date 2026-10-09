import { afterEach, describe, expect, it, vi } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/* A token-bearing client must never start a process, and must never load the
 * module that can (SCRUM-289). Both are made to throw, so reaching either is
 * a failure rather than something to notice in a log. */
vi.mock("node:child_process", () => {
  const boom = () => {
    throw new Error("a token-bearing client spawned a process");
  };
  return { execFile: boom, spawn: boom, exec: boom, fork: boom, default: { execFile: boom, spawn: boom } };
});
const cliLoaded = vi.fn();
vi.mock("../cli-transport.js", () => {
  cliLoaded();
  return {
    CliTransport: class {
      api = vi.fn(async () => ({ success: true, data: { via: "cli" } }));
      gmailAttachmentToDrive = vi.fn(async () => ({ success: true, data: { via: "cli" } }));
      authStatus = vi.fn(async () => ({ success: true, data: { via: "cli" } }));
    },
  };
});

const { GwsClient, TransientGwsError } = await import("../gws-client.js");
const { sendAuthorized } = await import("./direct-transport.js");

// Shaped like a real Google access token so a leak is unmistakable.
const TOKEN = "ya29.SECRET-bearer-0123456789";

function withFetch(respond: (url: string, init: RequestInit) => Response | Promise<Response>) {
  const requests: Array<{ url: string; init: RequestInit }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    requests.push({ url: String(input), init: init ?? {} });
    return respond(String(input), init ?? {});
  });
  return requests;
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

afterEach(() => {
  vi.restoreAllMocks();
  cliLoaded.mockClear();
});

describe("a token-bearing client talks to Google directly", () => {
  it("never spawns and never loads the CLI transport, across a read, a write and a copy to Drive", async () => {
    const requests = withFetch((url) =>
      url.includes("/attachments/") ? json({ size: 3, data: "SGk_" }) : json({ id: "x" })
    );
    const client = new GwsClient({ accessToken: TOKEN });
    await client.api("gmail", "users.messages", "list", { params: { userId: "me" } });
    await client.api("gmail", "users.messages", "send", { params: { userId: "me" }, jsonBody: { raw: "SGk" } });
    await client.gmailAttachmentToDrive({ messageId: "m1", attachmentId: "a1", name: "f.txt" });
    expect(requests.length).toBe(4);
    expect(cliLoaded).not.toHaveBeenCalled();
  });

  it("puts the token in the Authorization header and nowhere in the URL or body", async () => {
    const requests = withFetch(() => json({}));
    await new GwsClient({ accessToken: TOKEN }).api("calendar", "events", "patch", {
      params: { calendarId: "primary", eventId: "e1" },
      jsonBody: { summary: "x" },
    });
    const { url, init } = requests[0];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TOKEN}`);
    expect(url).not.toContain(TOKEN);
    expect(String(init.body)).not.toContain(TOKEN);
    expect(init.method).toBe("PATCH");
    expect(init.redirect).toBe("error");
    expect(JSON.parse(String(init.body))).toEqual({ summary: "x" });
  });

  it("with no token, hands the call to the CLI fallback and makes no request", async () => {
    const requests = withFetch(() => json({}));
    const out = await new GwsClient().api("gmail", "users.labels", "list", { params: { userId: "me" } });
    expect(out.data).toEqual({ via: "cli" });
    expect(requests).toHaveLength(0);
  });
});

describe("errors keep the text class tools and callers already read", () => {
  it("maps Google's JSON error to API error: {error:{code,message,reason}}", async () => {
    withFetch(() =>
      json(
        { error: { code: 403, message: "Request had insufficient authentication scopes.", errors: [{ reason: "insufficientPermissions" }], status: "PERMISSION_DENIED" } },
        403
      )
    );
    const err = (await new GwsClient({ accessToken: TOKEN })
      .api("gmail", "users.labels", "list", { params: { userId: "me" } })
      .catch((e: Error) => e)) as Error;
    expect(err.message).toBe(
      'API error: {"error":{"code":403,"message":"Request had insufficient authentication scopes.","reason":"insufficientPermissions"}}'
    );
    expect(err).not.toBeInstanceOf(TransientGwsError);
  });

  it("falls back to the newer format's reason, then to the status", async () => {
    withFetch(() => json({ error: { code: 403, message: "m", status: "PERMISSION_DENIED", details: [{ reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" }] } }, 403));
    const a = (await new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list").catch((e: Error) => e)) as Error;
    expect(a.message).toContain('"reason":"ACCESS_TOKEN_SCOPE_INSUFFICIENT"');
    vi.restoreAllMocks();
    withFetch(() => json({ error: { code: 404, message: "gone", status: "NOT_FOUND" } }, 404));
    const b = (await new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list").catch((e: Error) => e)) as Error;
    expect(b.message).toContain('"reason":"NOT_FOUND"');
  });

  it.each([502, 503, 504])("marks HTTP %i transient from the status code, even with an unhelpful body", async (status) => {
    withFetch(() => new Response("<html>upstream</html>", { status }));
    const err = await new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list").catch((e: Error) => e);
    expect(err).toBeInstanceOf(TransientGwsError);
  });

  it("does not mark a 404 or a 400 transient", async () => {
    for (const status of [400, 404, 409]) {
      vi.restoreAllMocks();
      withFetch(() => json({ error: { code: status, message: "no" } }, status));
      const err = await new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list").catch((e: Error) => e);
      expect(err).toBeInstanceOf(Error);
      expect(err).not.toBeInstanceOf(TransientGwsError);
    }
  });

  it("a 401 reads as authentication required, the wording the CLI transport used", async () => {
    withFetch(() => json({ error: { code: 401, message: "Invalid Credentials" } }, 401));
    await expect(new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list")).rejects.toThrow(
      /Google Workspace authentication required/
    );
  });

  it("an unknown method is refused before any request, in the discovery-error class", async () => {
    const requests = withFetch(() => json({}));
    await expect(new GwsClient({ accessToken: TOKEN }).api("gmail", "drafts", "list", {})).rejects.toThrow(
      /API discovery error: .*users\.messages/
    );
    await expect(new GwsClient({ accessToken: TOKEN }).api("__proto__", "x", "y", {})).rejects.toThrow(/unknown service/);
    expect(requests).toHaveLength(0);
  });
});

describe("the bearer token never reaches an error (SCRUM-289)", () => {
  const leaks = (err: unknown) => {
    const e = err as Error & { cause?: unknown };
    return [e.message, e.stack ?? "", String(e), JSON.stringify(e, Object.getOwnPropertyNames(e))].some((s) =>
      s.includes(TOKEN)
    );
  };

  it("not when Google rejects the call and echoes the credential back", async () => {
    withFetch(() => json({ error: { code: 400, message: "bad" } }, 400));
    const err = await new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list").catch((e: Error) => e);
    expect(leaks(err)).toBe(false);
  });

  it("not when fetch itself fails with an error that quotes the request", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
      const auth = (init?.headers as Record<string, string>).Authorization;
      const cause = Object.assign(new Error(`connect failed, headers were Authorization: ${auth}`), { code: "ECONNRESET" });
      throw Object.assign(new TypeError(`fetch failed for request with ${auth}`), { cause });
    });
    const err = await new GwsClient({ accessToken: TOKEN })
      .api("gmail", "users.messages", "list", { params: { userId: "me" } })
      .catch((e: Error) => e);
    expect(leaks(err)).toBe(false);
    // and it is still useful: named, and classed as retryable
    expect((err as Error).message).toContain("gmail users.messages list");
    expect(err).toBeInstanceOf(TransientGwsError);
  });

  it("not on a timeout", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw Object.assign(new Error(`The operation timed out: Bearer ${TOKEN}`), { name: "TimeoutError" });
    });
    const err = await new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list").catch((e: Error) => e);
    expect(leaks(err)).toBe(false);
    expect(err).toBeInstanceOf(TransientGwsError);
  });
});

describe("response handling matches what callers were written against", () => {
  it("an empty body reads as the empty string, JSON as JSON, other text trimmed", async () => {
    const client = new GwsClient({ accessToken: TOKEN });
    withFetch(() => new Response(null, { status: 204 }));
    expect((await client.api("tasks", "tasks", "delete", { params: { tasklist: "l", task: "t" } })).data).toBe("");
    vi.restoreAllMocks();
    withFetch(() => new Response("name,total\nA,1\n", { status: 200 }));
    expect((await client.api("drive", "files", "get", { params: { fileId: "f", alt: "media" } })).data).toBe("name,total\nA,1");
  });

  it("dry_run builds the request and sends nothing", async () => {
    const requests = withFetch(() => json({}));
    const out = await new GwsClient({ accessToken: TOKEN }).api("gmail", "users.messages", "list", {
      params: { userId: "me", labelIds: ["INBOX", "UNREAD"] },
      dryRun: true,
    });
    expect(requests).toHaveLength(0);
    expect(out.data).toEqual({
      body: null,
      dry_run: true,
      is_multipart_upload: false,
      method: "GET",
      query_params: [["labelIds", "INBOX"], ["labelIds", "UNREAD"]],
      url: "https://gmail.googleapis.com/gmail/v1/users/me/messages",
    });
  });

  it("page_all follows nextPageToken, one JSON document per line, and stops at the page limit", async () => {
    let n = 0;
    const requests = withFetch(() => json({ items: [++n], nextPageToken: `p${n}` }));
    const out = await new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list", { pageAll: true });
    expect(requests).toHaveLength(10);
    expect(new URL(requests[0].url).searchParams.has("pageToken")).toBe(false);
    expect(new URL(requests[3].url).searchParams.get("pageToken")).toBe("p3");
    const lines = String(out.data).split("\n");
    expect(lines).toHaveLength(10);
    expect(JSON.parse(lines[9])).toEqual({ items: [10], nextPageToken: "p10" });
  });

  it("page_all with a single page is plain JSON, as it was", async () => {
    withFetch(() => json({ items: [1] }));
    const out = await new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list", { pageAll: true });
    expect(out.data).toEqual({ items: [1] });
  });
});

describe("one response cannot exhaust the process every session shares", () => {
  const big = (bytes: number, withLength: boolean) => {
    let sent = 0;
    const pulled = { chunks: 0 };
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent >= bytes) return controller.close();
        pulled.chunks++;
        sent += 1 << 20;
        controller.enqueue(new Uint8Array(1 << 20));
      },
    });
    const res = new Response(stream, { status: 200, headers: withLength ? { "content-length": String(bytes) } : {} });
    return { res, pulled };
  };

  it("refuses a declared oversize body without reading it", async () => {
    const { res, pulled } = big(400 << 20, true);
    withFetch(() => res);
    await expect(
      new GwsClient({ accessToken: TOKEN }).api("drive", "files", "get", { params: { fileId: "f", alt: "media" } })
    ).rejects.toThrow(/larger than 10485760 bytes/);
    expect(pulled.chunks).toBeLessThanOrEqual(1);
  });

  it("stops reading an undeclared oversize body just past the cap, not at its end", async () => {
    const { res, pulled } = big(400 << 20, false);
    withFetch(() => res);
    await expect(new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list")).rejects.toThrow(/larger than/);
    expect(pulled.chunks).toBeLessThan(15);
  });

  it("a body at the cap still reads", async () => {
    const body = JSON.stringify({ pad: "x".repeat(10 * 1024 * 1024 - 10) });
    withFetch(() => new Response(body, { status: 200 }));
    const out = await new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list");
    expect((out.data as { pad: string }).pad.length).toBe(10 * 1024 * 1024 - 10);
  });
});

describe("page_all shares one budget across its pages", () => {
  it("fails the call once the pages together pass the bound, instead of holding ten times it", async () => {
    const page = (n: number) => JSON.stringify({ n, pad: "x".repeat(3 * 1024 * 1024), nextPageToken: `p${n}` });
    let n = 0;
    const requests = withFetch(() => new Response(page(++n), { status: 200 }));
    await expect(
      new GwsClient({ accessToken: TOKEN }).api("drive", "files", "list", { pageAll: true })
    ).rejects.toThrow(/larger than 10485760 bytes/);
    // three pages fit, the fourth crosses; it never goes on to ten
    expect(requests).toHaveLength(4);
  });

  it("pretty-printed pages still come back one document per line", async () => {
    let n = 0;
    withFetch(() => new Response(JSON.stringify({ n: ++n, ...(n < 3 ? { nextPageToken: `p${n}` } : {}) }, null, 2), { status: 200 }));
    const out = await new GwsClient({ accessToken: TOKEN }).api("drive", "files", "list", { pageAll: true });
    expect(String(out.data).split("\n").map((l) => JSON.parse(l).n)).toEqual([1, 2, 3]);
  });
});

describe("a path value cannot leave its method's path", () => {
  it.each([
    ["people", "people", "get", { resourceName: "../../gmail/v1/users/me/messages", personFields: "names" }],
    ["people", "people", "get", { resourceName: "people/../../x", personFields: "names" }],
    ["drive", "files", "get", { fileId: ".." }],
    ["gmail", "users.messages", "list", { userId: ".." }],
    ["gmail", "users.messages", "get", { userId: "me", id: "." }],
  ])("%s %s %s refuses a dot segment before any request", async (service, resource, method, params) => {
    const requests = withFetch(() => json({}));
    await expect(new GwsClient({ accessToken: TOKEN }).api(service, resource, method, { params })).rejects.toThrow(
      /must not contain a "\." or "\.\." segment/
    );
    expect(requests).toHaveLength(0);
  });

  it("still lets dots that are not a whole segment through, encoded", async () => {
    const requests = withFetch(() => json({}));
    await new GwsClient({ accessToken: TOKEN }).api("people", "people", "get", {
      resourceName: undefined,
      params: { resourceName: "people/c1.2..3", personFields: "names" },
    } as never);
    expect(new URL(requests[0].url).pathname).toBe("/v1/people/c1%2E2%2E%2E3");
  });
});

describe("a path value is a plain id (SCRUM-289 follow-up)", () => {
  it.each([
    ["an empty middle segment", "people//c1"],
    ["a leading slash", "/people/c1"],
    ["a trailing slash", "people/c1/"],
  ])("a slash-keeping value with %s is refused before any request", async (_, resourceName) => {
    const requests = withFetch(() => json({}));
    await expect(
      new GwsClient({ accessToken: TOKEN }).api("people", "people", "get", { params: { resourceName, personFields: "names" } })
    ).rejects.toThrow(/must not contain an empty segment/);
    expect(requests).toHaveLength(0);
  });

  it.each([
    ["an array", ["a", ".."]],
    ["an object", { id: "a" }],
    ["a boolean", true],
  ])("%s as a path value is refused by type, not coerced into the URL", async (_, fileId) => {
    const requests = withFetch(() => json({}));
    await expect(
      new GwsClient({ accessToken: TOKEN }).api("drive", "files", "get", { params: { fileId } })
    ).rejects.toThrow(/path parameter "fileId" must be a string or a number/);
    expect(requests).toHaveLength(0);
  });

  it("a number is still a path value", async () => {
    const requests = withFetch(() => json({}));
    await new GwsClient({ accessToken: TOKEN }).api("drive", "files", "get", { params: { fileId: 42 } });
    expect(new URL(requests[0].url).pathname).toBe("/drive/v3/files/42");
  });
});

describe("a caller's headers cannot replace the token (SCRUM-289 follow-up)", () => {
  it.each([["Authorization"], ["authorization"], ["AUTHORIZATION"]])(
    "a caller-supplied %s header is dropped, in any letter case, and the rest are kept",
    async (name) => {
      const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
      await sendAuthorized("tok", { method: "GET", url: "https://www.googleapis.com/drive/v3/files" }, "t", {
        timeout: 1000,
        headers: { [name]: "Bearer someone-else", "Content-Type": "text/plain" },
      });
      const sent = new Headers(spy.mock.calls[0][1]?.headers as Record<string, string>);
      expect(sent.get("authorization")).toBe("Bearer tok");
      expect(sent.get("content-type")).toBe("text/plain");
      spy.mockRestore();
    }
  );
});

describe("the error code echoed from a network failure is only ever a code", () => {
  it("drops a code that does not look like one, even if it carries the token", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: `Bearer ${TOKEN}` } });
    });
    const err = (await new GwsClient({ accessToken: TOKEN }).api("tasks", "tasklists", "list").catch((e: Error) => e)) as Error;
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).toContain("network error");
  });
});

/* "THE ONE PLACE THE TOKEN IS USED" is a claim about the whole source tree,
 * so the tree is what gets read. Comments are stripped first: prose quoting
 * the header would otherwise satisfy or break the count on its own. */
describe("the token is put on the wire in one place (SCRUM-289)", () => {
  const srcRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const sources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? sources(path.join(dir, e.name))
        : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !e.name.includes("test-helper")
          ? [path.join(dir, e.name)]
          : []
    );
  const code = (file: string) =>
    readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");

  it("one Bearer header and one fetch call in src, both in sendAuthorized's file", () => {
    const files = sources(srcRoot);
    expect(files.length).toBeGreaterThan(20);
    const hits = (re: RegExp) =>
      files.flatMap((f) => (code(f).match(re) ?? []).map(() => path.relative(srcRoot, f)));
    expect(hits(/Bearer \$\{/g)).toEqual([path.join("google-api", "direct-transport.ts")]);
    expect(hits(/(?<![.\w])fetch\(/g)).toEqual([path.join("google-api", "direct-transport.ts")]);
  });

  it("the default destination is the API rule: docs.google.com is refused unless asked for by name", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    const target = { method: "GET", url: "https://docs.google.com/spreadsheets/d/s/gviz/tq" };
    await expect(sendAuthorized("tok", target, "t", { timeout: 1000 })).rejects.toThrow(/non-Google URL/);
    expect(spy).not.toHaveBeenCalled();
    await sendAuthorized("tok", target, "t", { timeout: 1000, destination: "visualization" });
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]?.redirect).toBe("manual");
    spy.mockRestore();
  });

  it("the visualization destination is not a wider door: an arbitrary googleapis host is refused there", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}"));
    await expect(
      sendAuthorized("tok", { method: "GET", url: "https://evil.googleapis.com/x" }, "t", { timeout: 1000, destination: "visualization" })
    ).rejects.toThrow(/only reaches Google origins/);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
