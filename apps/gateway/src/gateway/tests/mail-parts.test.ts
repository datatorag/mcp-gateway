/**
 * The part reader (SCRUM-303). Every assertion the signature cases make is
 * about a MIME tree, so the reader that flattens it is worth its own tests:
 * a case failing because the reader missed a nested part would be read as a
 * signature defect.
 */

import { describe, expect, it } from "vitest";
import type { ToolResult } from "./types";
import {
  arrivalQuery,
  countSignatureBlocks,
  NO_MESSAGES,
  searchHits,
  decodePart,
  flattenParts,
  isMultipartAlternative,
  partText,
  deliveredIds,
} from "./mail-parts";

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");

describe("deliveredIds", () => {
  it("keeps a hit labelled INBOX, including one also labelled SENT", () => {
    // A message sent to oneself is one message carrying both.
    expect(
      deliveredIds([
        { id: "a", labelIds: ["SENT", "INBOX", "UNREAD"] },
        { id: "b", labelIds: ["INBOX"] },
      ])
    ).toEqual(["a", "b"]);
  });

  it("drops a draft, a sent-only copy, and a hit with no label list", () => {
    expect(
      deliveredIds([
        { id: "d", labelIds: ["DRAFT", "INBOX"] },
        { id: "s", labelIds: ["SENT"] },
        { id: "n" },
        null,
        "x",
      ])
    ).toEqual([]);
  });

  it("answers nothing for a search that did not come back as a list", () => {
    expect(deliveredIds("No messages found.")).toEqual([]);
    expect(deliveredIds(null)).toEqual([]);
  });
});

describe("decodePart", () => {
  it("decodes base64url, which is what Gmail sends", () => {
    expect(decodePart(b64("hello > world?"))).toBe("hello > world?");
  });

  it("gives an empty string for a part with no data", () => {
    expect(decodePart(undefined)).toBe("");
  });
});

describe("partText", () => {
  const payload = {
    mimeType: "multipart/alternative",
    parts: [
      { mimeType: "text/plain", body: { data: b64("plain body") } },
      { mimeType: "text/html", body: { data: b64("<p>html body</p>") } },
    ],
  };

  it("finds a part by mime type", () => {
    expect(partText(payload, "text/plain")).toBe("plain body");
    expect(partText(payload, "text/html")).toBe("<p>html body</p>");
  });

  it("finds a part nested deeper, which a one-level scan would miss", () => {
    const nested = {
      mimeType: "multipart/mixed",
      parts: [{ mimeType: "multipart/alternative", parts: payload.parts }],
    };
    expect(partText(nested, "text/html")).toBe("<p>html body</p>");
  });

  it("gives an empty string when the type is absent", () => {
    expect(partText(payload, "text/calendar")).toBe("");
  });
});

describe("countSignatureBlocks", () => {
  it("counts, because signed twice looks like signed once to a presence check", () => {
    const one = '<div class="gmail_signature">a</div>';
    expect(countSignatureBlocks(one)).toBe(1);
    expect(countSignatureBlocks(one + one)).toBe(2);
    expect(countSignatureBlocks("<p>no signature here</p>")).toBe(0);
  });

  it("matches the marker among other classes and either quote style", () => {
    expect(countSignatureBlocks(`<div class='x gmail_signature y'>a</div>`)).toBe(1);
  });

  it("does not match a word that merely contains the marker", () => {
    expect(countSignatureBlocks('<div class="gmail_signature_wrapper">a</div>')).toBe(0);
  });
});

describe("isMultipartAlternative", () => {
  it("is true only at the top level", () => {
    expect(isMultipartAlternative({ mimeType: "multipart/alternative" })).toBe(true);
    expect(isMultipartAlternative({ mimeType: "text/plain" })).toBe(false);
    expect(isMultipartAlternative(undefined)).toBe(false);
  });
});

describe("flattenParts", () => {
  it("includes the parent as well as the children", () => {
    const tree = { mimeType: "multipart/mixed", parts: [{ mimeType: "text/plain" }] };
    expect(flattenParts(tree).map((p) => p.mimeType)).toEqual(["multipart/mixed", "text/plain"]);
  });
});

/** SCRUM-428, run 103bb1d2: with two accounts on different domains, a
 * reply and a draft arrived in the recipient's Spam and the cases, whose
 * searches left Spam out, timed out waiting for mail that had arrived. */
describe("arrival across the recipient's own filing", () => {
  const hit = (id: string, labelIds: string[]) => ({ id, labelIds });

  it("counts a message the recipient filed as Spam as delivered", () => {
    expect(deliveredIds([hit("a", ["INBOX"]), hit("b", ["SPAM", "UNREAD"])])).toEqual(["a", "b"]);
  });

  it("still never counts a draft, or a message in neither the inbox nor Spam", () => {
    expect(deliveredIds([hit("d", ["DRAFT", "INBOX"]), hit("s", ["SENT"]), hit("t", ["TRASH"])])).toEqual([]);
  });

  it("searches everywhere but Trash", () => {
    expect(arrivalQuery('subject:"x"')).toBe('in:anywhere -in:trash subject:"x"');
  });

  const answer = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value) }] });

  it("reads the plugin's no-match answer as an empty list, so a sweep with nothing to sweep does not throw", () => {
    expect(searchHits(answer(NO_MESSAGES))).toEqual([]);
  });

  it("reads a list as its hits, and anything else as unreadable", () => {
    expect(searchHits(answer([{ id: "a" }]))).toEqual([{ id: "a" }]);
    expect(searchHits(answer("something else"))).toBeNull();
  });
});
