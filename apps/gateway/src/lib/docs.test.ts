import { describe, expect, it } from "vitest";
import {
  getAllDocs,
  getConnectorGroups,
  getDocNeighbors,
  getDocsSequence,
  getTopLevelDocs,
} from "./docs";

/* The reading order behind Previous and Next. It is the sidebar's order, built
   from the same two lists the sidebar renders, so a page's Next is the entry
   under it in the sidebar. */
describe("docs reading order", () => {
  const sequence = getDocsSequence().map((d) => d.slug);

  it("holds every docs page exactly once", () => {
    const all = getAllDocs().map((d) => d.slug);
    // Guards the guard: an empty collection would pass everything below.
    expect(all.length).toBeGreaterThan(10);
    // A page missing here has no Previous or Next and is in no sidebar list:
    // its `connector` names a connector that is not in the registry.
    expect(all.filter((slug) => !sequence.includes(slug))).toEqual([]);
    // A page listed twice is both an overview and a child page.
    expect(sequence.filter((slug, i) => sequence.indexOf(slug) !== i)).toEqual([]);
    expect(sequence.length).toBe(all.length);
  });

  it("is the sidebar's order: the general pages, then each connector's overview and its pages", () => {
    const sidebar = [
      ...getTopLevelDocs(),
      ...getConnectorGroups().flatMap((g) => [...(g.overview ? [g.overview] : []), ...g.pages]),
    ].map((d) => d.slug);
    expect(sequence).toEqual(sidebar);
  });

  it("keeps a connector's pages together", () => {
    // Two pages that share an `order` value across sections used to interleave.
    expect(getDocNeighbors("sheets").next?.slug).toBe("slides");
    expect(getDocNeighbors("gmail").prev?.slug).toBe("google-workspace");
    expect(getDocNeighbors("getting-started").next?.connector).toBeNull();
  });

  it("has no Previous on the first page, no Next on the last, and neither for an unknown slug", () => {
    expect(getDocNeighbors(sequence[0]).prev).toBeNull();
    expect(getDocNeighbors(sequence[sequence.length - 1]).next).toBeNull();
    expect(getDocNeighbors("no-such-page")).toEqual({ prev: null, next: null });
  });
});
