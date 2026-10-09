import { describe, expect, it } from "vitest";
import { addressLine, distinctMailboxes, firstAddress, parseAddressList } from "./address-list.js";

/** Address headers read the way RFC 5322 writes them (SCRUM-310). What these
 * parse becomes the recipient of a reply, so each shape that a split on
 * commas or angle brackets gets wrong has a case. */

const addresses = (h: string) => parseAddressList(h).map((m) => m.address);

describe("one mailbox", () => {
  it("a bare address", () => {
    expect(parseAddressList("a@example.com")).toEqual([{ address: "a@example.com" }]);
  });

  it("a name and an angle address", () => {
    expect(parseAddressList("Jane Doe <jane@example.com>")).toEqual([{ name: "Jane Doe", address: "jane@example.com" }]);
  });

  it("a quoted name holding a comma is one mailbox, not two", () => {
    expect(parseAddressList('"Doe, Jane" <jane@example.com>')).toEqual([{ name: "Doe, Jane", address: "jane@example.com" }]);
  });

  it("a quoted name holding escaped quotes and an angle bracket", () => {
    expect(parseAddressList('"Jane \\"JD\\" <the boss>" <jane@example.com>')).toEqual([
      { name: 'Jane "JD" <the boss>', address: "jane@example.com" },
    ]);
  });

  it("a quoted name holding what looks like another address", () => {
    // The address is the one in the angle brackets, never the one in the name.
    expect(addresses('"evil@attacker.example" <real@example.com>')).toEqual(["real@example.com"]);
    expect(addresses('"x <evil@attacker.example>" <real@example.com>')).toEqual(["real@example.com"]);
  });

  it("comments are skipped, nested ones too", () => {
    expect(addresses("jane@example.com (Jane (the boss) Doe)")).toEqual(["jane@example.com"]);
    expect(addresses("(note, with a comma) Jane <jane@example.com>")).toEqual(["jane@example.com"]);
  });
});

describe("several mailboxes", () => {
  it("splits on the commas between them and only those", () => {
    expect(addresses('a@example.com, "Doe, Jane" <jane@example.com>,Bob <bob@example.com>')).toEqual([
      "a@example.com",
      "jane@example.com",
      "bob@example.com",
    ]);
  });

  it("reads a group's members and an empty group as nobody", () => {
    expect(addresses("Team: a@example.com, Bob <bob@example.com>;, c@example.com")).toEqual([
      "a@example.com",
      "bob@example.com",
      "c@example.com",
    ]);
    expect(addresses("undisclosed-recipients:;")).toEqual([]);
  });

  it("a header folded over lines reads as one line", () => {
    expect(addresses("a@example.com,\r\n b@example.com")).toEqual(["a@example.com", "b@example.com"]);
  });
});

describe("what is dropped rather than repaired", () => {
  it("an entry with no usable address", () => {
    expect(addresses("Jane Doe, <>, <not an address>, real@example.com")).toEqual(["real@example.com"]);
    expect(addresses("")).toEqual([]);
    expect(parseAddressList(undefined)).toEqual([]);
  });

  it("an address carrying a line break or a second header", () => {
    expect(addresses("<a@example.com\r\nBcc: evil@attacker.example>")).toEqual([]);
    // A break that is not a fold ends the header: the address before it
    // stands, and the line after it is not read at all.
    expect(addresses("a@example.com\r\nBcc: evil@attacker.example")).toEqual(["a@example.com"]);
    expect(addresses("a@example.com\nevil@attacker.example")).toEqual(["a@example.com"]);
  });

  it("an entry with two angle addresses is dropped, not resolved to one of them", () => {
    expect(addresses("x <a@example.com> <b@example.com>, c@example.com")).toEqual(["c@example.com"]);
  });

  it("quoted text is a name, never an address, with or without its closing quote", () => {
    expect(addresses('"evil@attacker.example"')).toEqual([]);
    expect(addresses('"evil@attacker.example')).toEqual([]);
    expect(addresses('"evil@attacker.example", real@example.com')).toEqual(["real@example.com"]);
  });

  it("an address before a colon is not a group name: nothing after it is read", () => {
    expect(addresses("a@example.com: evil@attacker.example")).toEqual([]);
    expect(addresses("A <a@example.com>: evil@attacker.example")).toEqual([]);
    expect(addresses("a@example.com\r\n Bcc: evil@attacker.example")).toEqual([]);
    // A real group still reads.
    expect(addresses("Team: a@example.com;")).toEqual(["a@example.com"]);
  });

  it("an unterminated angle bracket or quote ends the list without inventing an address", () => {
    expect(addresses("Jane <jane@example.com")).toEqual([]);
    expect(addresses('"Jane <jane@example.com>, b@example.com')).toEqual([]);
  });
});

describe("the helpers", () => {
  it("firstAddress is the first mailbox's address, or empty", () => {
    expect(firstAddress('"Doe, Jane" <jane@example.com>, b@example.com')).toBe("jane@example.com");
    expect(firstAddress("nobody here")).toBe("");
  });

  it("distinctMailboxes drops repeats and exclusions, ignoring case", () => {
    const list = parseAddressList("A@Example.com, b@example.com, a@example.com, Me <me@example.com>");
    expect(distinctMailboxes(list, ["ME@example.com"]).map((m) => m.address)).toEqual(["A@Example.com", "b@example.com"]);
  });

  it("addressLine carries addresses only, never the names", () => {
    expect(addressLine(parseAddressList('"Doe, Jane" <jane@example.com>, Bob <bob@example.com>'))).toBe(
      "jane@example.com, bob@example.com"
    );
  });

  it("reads a very long header in linear time", () => {
    const hostile = '"'.repeat(1) + "a,".repeat(200_000);
    const started = Date.now();
    parseAddressList(hostile);
    parseAddressList("(".repeat(100_000));
    parseAddressList("<".repeat(100_000));
    expect(Date.now() - started).toBeLessThan(1000);
  });
});
