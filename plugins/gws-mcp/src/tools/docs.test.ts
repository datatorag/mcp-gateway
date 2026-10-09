import { describe, expect, it } from "vitest";
import { docsTools, handleDocs } from "./docs.js";
import { validateArgs } from "./validate.js";
import { fakeClient, payload } from "./fake-client.test-helper.js";

/** A three-run document whose total extent is 12 — the same number mode
 * "index" would report as the last endIndex, which is the coordinate system
 * start_index/end_index share with docs_batch_update. */
const doc = () => ({
  data: {
    documentId: "doc-fixture-1",
    title: "Fixture",
    body: {
      content: [
        {
          paragraph: {
            elements: [
              { startIndex: 1, endIndex: 6, textRun: { content: "Alpha" } },
              { startIndex: 6, endIndex: 7, textRun: { content: "\n" } },
            ],
          },
        },
        {
          paragraph: {
            elements: [
              { startIndex: 7, endIndex: 12, textRun: { content: "Bravo" } },
            ],
          },
        },
      ],
    },
  },
});

const docsGet = docsTools.find((t) => t.name === "docs_get")!;

describe("docs_get without a range (SCRUM-174: behaviour unchanged)", () => {
  it("returns the full text and none of the slice metadata keys", async () => {
    const { client } = fakeClient([doc()]);
    const result = payload(
      await handleDocs(client, "docs_get", { document_id: "doc-fixture-1" })
    );
    expect(result.text).toBe("Alpha\nBravo");
    // The no-range response shape is pinned: adding keys to it is the
    // behaviour change the ticket forbids.
    expect(result).not.toHaveProperty("totalEndIndex");
    expect(result).not.toHaveProperty("clipped");
    expect(result).not.toHaveProperty("nextStartIndex");
  });
});

describe("docs_get with start_index/end_index (SCRUM-174)", () => {
  // Failing shape before the change, stated up front: the handler ignored
  // start_index/end_index entirely, so the slice assertions below received
  // the FULL document text and failed (and the boundary rejected the
  // parameters as unknown, which is the exact real-world failure).
  it("slices text mode and reports total, clipped, and continuation", async () => {
    const { client } = fakeClient([doc()]);
    const result = payload(
      await handleDocs(client, "docs_get", {
        document_id: "doc-fixture-1",
        start_index: 3,
        end_index: 9,
      })
    );
    expect(result.text).toBe("pha\nBr");
    expect(result.totalEndIndex).toBe(12);
    expect(result.clipped).toBe(true);
    expect(result.nextStartIndex).toBe(9);
  });

  it("keeps ABSOLUTE indices in index mode, trimmed to the slice", async () => {
    const { client } = fakeClient([doc()]);
    const result = payload(
      await handleDocs(client, "docs_get", {
        document_id: "doc-fixture-1",
        mode: "index",
        start_index: 3,
        end_index: 9,
      })
    );
    // The same coordinate space docs_batch_update consumes: these numbers
    // can go straight into a deleteContentRange.
    expect(result.content[0]).toEqual({ startIndex: 3, endIndex: 6, text: "pha" });
    expect(result.content.at(-1)).toEqual({ startIndex: 7, endIndex: 9, text: "Br" });
    expect(result.totalEndIndex).toBe(12);
    expect(result.clipped).toBe(true);
  });

  it("a slice reaching the end is not clipped and offers no continuation", async () => {
    const { client } = fakeClient([doc()]);
    const result = payload(
      await handleDocs(client, "docs_get", {
        document_id: "doc-fixture-1",
        start_index: 7,
      })
    );
    expect(result.text).toBe("Bravo");
    expect(result.totalEndIndex).toBe(12);
    expect(result.clipped).toBe(false);
    expect(result).not.toHaveProperty("nextStartIndex");
  });

  it("rejects a range with mode full before any API call", async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleDocs(client, "docs_get", {
        document_id: "doc-fixture-1",
        mode: "full",
        start_index: 1,
      })
    ).rejects.toThrow('cannot be combined with mode "full"');
    expect(calls).toHaveLength(0);
  });

  it("rejects start_index >= end_index before any API call", async () => {
    const { client, calls } = fakeClient([]);
    await expect(
      handleDocs(client, "docs_get", {
        document_id: "doc-fixture-1",
        start_index: 9,
        end_index: 3,
      })
    ).rejects.toThrow("must be less than");
    expect(calls).toHaveLength(0);
  });

  it("passes boundary validation, which rejected these params before", () => {
    expect(() =>
      validateArgs(docsGet, { document_id: "d", start_index: 3, end_index: 9 })
    ).not.toThrow();
  });
});

describe("docs_batch_update request-shape documentation (SCRUM-175)", () => {
  it("shows matchCase nested inside containsText, with the warning", () => {
    const tool = docsTools.find((t) => t.name === "docs_batch_update")!;
    const requests = (
      tool.inputSchema.properties as Record<string, { description?: string }>
    ).requests;
    expect(requests.description).toContain(
      'containsText: { text: "old", matchCase: true }'
    );
    expect(requests.description).toContain("INSIDE containsText");
    expect(requests.description).toContain("updateTextStyle");
  });
});
