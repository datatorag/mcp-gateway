// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ServiceMarks, serviceMarksWidth } from "./service-marks";

const render = (marks: Parameters<typeof ServiceMarks>[0]["marks"]) => {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(<ServiceMarks marks={marks} size={16} separatorClassName="ring-black" />);
  // By its own attribute: the renderer may put image preload hints ahead of it.
  const stack = host.querySelector<HTMLElement>("[data-service-marks]")!;
  const tiles = [...stack.children] as HTMLElement[];
  return { stack, tiles, imgs: tiles.map((t) => t.querySelector("img")!) };
};

describe("a persona's product marks", () => {
  it("is one shipped mark on a tile at the agent logos' size, named for a screen reader", () => {
    const { stack, tiles, imgs } = render(["sheets"]);
    expect(stack.getAttribute("role")).toBe("img");
    expect(stack.getAttribute("aria-label")).toBe("Google Sheets");
    expect(tiles.map((t) => [t.style.width, t.style.height, t.style.marginLeft])).toEqual([["22px", "22px", "0px"]]);
    expect(imgs.map((i) => [i.getAttribute("src"), i.getAttribute("width"), i.getAttribute("alt")])).toEqual([
      ["/icons/services/sheets.svg", "16", ""],
    ]);
  });

  it("stacks two marks like profile pictures: each on its own full-size tile, the second over the first by a third, ringed", () => {
    const { stack, tiles, imgs } = render(["jira", "confluence"]);
    expect(stack.getAttribute("aria-label")).toBe("Jira and Confluence");
    expect(tiles.map((t) => [t.style.width, t.style.marginLeft])).toEqual([
      ["22px", "0px"],
      ["22px", "-7px"],
    ]);
    expect(tiles[1].className).toContain("ring-2");
    expect(tiles[1].className).toContain("ring-black");
    // No mark is shrunk or dimmed.
    expect(imgs.map((i) => i.getAttribute("width"))).toEqual(["16", "16"]);
    expect(stack.innerHTML).not.toContain("opacity");
    expect(imgs.map((i) => i.getAttribute("src"))).toEqual(["/icons/services/jira.svg", "/icons/services/confluence.svg"]);
  });

  it("shows the same product twice as two tiles, and names it once", () => {
    const { stack, tiles } = render(["gmail", "gmail"]);
    expect(tiles.length).toBe(2);
    expect(stack.getAttribute("aria-label")).toBe("Gmail");
  });

  it("says how wide a stack is, so a column can keep one left edge for its text", () => {
    expect(serviceMarksWidth(1, 16)).toBe(22);
    expect(serviceMarksWidth(2, 16)).toBe(37);
  });
});
