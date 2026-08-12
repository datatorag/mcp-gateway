/**
 * Can one user reach another user's conversation?
 *
 * This is the IDOR test for the thread gate. The thing being protected is the
 * text of somebody's chat, which is the most private data this product holds,
 * and the storage primitive underneath the delete takes an id with no owner
 * attached — so the only thing standing between a stranger's id and a
 * stranger's conversation is the check in `threads.ts`.
 *
 * The storage layer is faked here on purpose. A fake cannot show a MISSING
 * response, so it is the wrong tool for asking whether storage enforces
 * anything (that was established against real rows: a foreign resource id
 * yields null from `getThreadById` and zero from `listMessages`). It is the
 * right tool for asking whether OUR gate refuses before it ever gets there,
 * which is a question about our code and must hold even if a dependency stops
 * filtering.
 *
 * So the fake deliberately does NOT filter by resource. It hands back whatever
 * id is asked for. If the gate leans on storage to enforce ownership, every
 * test below fails, which is exactly the coupling worth catching.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const OWNER = "11111111-1111-1111-1111-111111111111";
const STRANGER = "22222222-2222-2222-2222-222222222222";
const THREAD = "thread-owned-by-owner";

let deleted: string[] = [];
let updated: Array<{ id: string; title: string }> = [];

/** A storage double that enforces NOTHING, so the gate has to. */
const store = {
  listThreads: vi.fn(async ({ filter }: { filter?: { resourceId?: string } }) => ({
    threads: [
      { id: THREAD, resourceId: OWNER, title: "", updatedAt: new Date("2026-08-01") },
      { id: "other", resourceId: STRANGER, title: "", updatedAt: new Date("2026-08-02") },
    ].filter((t) => !filter?.resourceId || t.resourceId === filter.resourceId),
  })),
  // Ignores resourceId entirely — the point of the double.
  getThreadById: vi.fn(async ({ threadId }: { threadId: string }) =>
    threadId === THREAD
      ? { id: THREAD, resourceId: OWNER, title: "", updatedAt: new Date("2026-08-01") }
      : null
  ),
  listMessages: vi.fn(async () => ({
    messages: [{ id: "m1", role: "user", content: { parts: [] }, createdAt: new Date("2026-08-01") }],
  })),
  deleteThread: vi.fn(async (id: string) => {
    deleted.push(id);
  }),
  updateThread: vi.fn(async ({ id, title }: { id: string; title: string }) => {
    updated.push({ id, title });
    return {};
  }),
};

vi.mock("@/mastra", () => ({ getMemoryStore: async () => store }));

const {
  listThreadsForUser,
  readThreadForUser,
  deleteThreadForUser,
  setThreadTitleIfEmpty,
} = await import("./threads");

beforeEach(() => {
  deleted = [];
  updated = [];
  vi.clearAllMocks();
});

describe("reading another user's conversation", () => {
  it("returns NOT FOUND, not the messages", async () => {
    expect(await readThreadForUser(STRANGER, THREAD)).toBeNull();
  });

  it("returns the SAME answer for a foreign id as for one that never existed", async () => {
    // Anything that distinguishes these two is an oracle for whether a given
    // thread exists on someone else's account.
    const foreign = await readThreadForUser(STRANGER, THREAD);
    const missing = await readThreadForUser(STRANGER, "no-such-thread");
    expect(foreign).toEqual(missing);
    expect(foreign).toBeNull();
  });

  it("still lets the owner read it, so the guard is not simply refusing everything", async () => {
    const messages = await readThreadForUser(OWNER, THREAD);
    expect(messages).not.toBeNull();
    expect(messages).toHaveLength(1);
  });
});

describe("deleting another user's conversation", () => {
  it("refuses, and does not reach the storage primitive at all", async () => {
    // The primitive takes an id with no owner. Reporting false while still
    // calling it would delete the conversation and lie about it.
    expect(await deleteThreadForUser(STRANGER, THREAD)).toBe(false);
    expect(deleted, "a foreign thread was passed to deleteThread").toEqual([]);
    expect(store.deleteThread).not.toHaveBeenCalled();
  });

  it("deletes for the owner, and means gone", async () => {
    expect(await deleteThreadForUser(OWNER, THREAD)).toBe(true);
    expect(deleted).toEqual([THREAD]);
  });

  it("answers a never-existed id the same way as a foreign one", async () => {
    expect(await deleteThreadForUser(OWNER, "no-such-thread")).toBe(false);
    expect(deleted).toEqual([]);
  });
});

describe("listing", () => {
  it("asks storage for this user's threads only", async () => {
    const list = await listThreadsForUser(OWNER);
    expect(store.listThreads).toHaveBeenCalledWith(
      expect.objectContaining({ filter: { resourceId: OWNER } })
    );
    expect(list.map((t) => t.id)).toEqual([THREAD]);
  });

  it("never returns a thread belonging to someone else", async () => {
    const list = await listThreadsForUser(STRANGER);
    expect(list.every((t) => t.id !== THREAD)).toBe(true);
  });

  it("returns nothing for a missing user id rather than everything", async () => {
    // A falsy id must not become "no filter", which is the classic way a list
    // endpoint turns into a dump of every row in the table.
    expect(await listThreadsForUser("")).toEqual([]);
    expect(store.listThreads).not.toHaveBeenCalled();
  });
});

describe("titling", () => {
  it("will not title a thread the user does not own", async () => {
    await setThreadTitleIfEmpty(STRANGER, THREAD, "hello");
    expect(updated).toEqual([]);
  });

  it("titles an untitled thread for its owner", async () => {
    await setThreadTitleIfEmpty(OWNER, THREAD, "What is in my Drive");
    expect(updated).toEqual([{ id: THREAD, title: "What is in my Drive" }]);
  });

  it("does not overwrite a title that already exists", async () => {
    store.getThreadById.mockResolvedValueOnce({
      id: THREAD,
      resourceId: OWNER,
      title: "Already named",
    } as never);
    await setThreadTitleIfEmpty(OWNER, THREAD, "Something else");
    expect(updated).toEqual([]);
  });
});

describe("the guard cannot be satisfied by storage alone", () => {
  it("refuses a foreign owner even when storage hands the thread over", async () => {
    // Simulates the dependency-bump failure: storage stops honouring
    // resourceId and returns the row regardless. The gate's own comparison is
    // what must still refuse.
    store.getThreadById.mockResolvedValueOnce({
      id: THREAD,
      resourceId: OWNER,
      title: "",
    } as never);
    expect(await readThreadForUser(STRANGER, THREAD)).toBeNull();
    store.getThreadById.mockResolvedValueOnce({
      id: THREAD,
      resourceId: OWNER,
      title: "",
    } as never);
    expect(await deleteThreadForUser(STRANGER, THREAD)).toBe(false);
    expect(deleted).toEqual([]);
  });
});
