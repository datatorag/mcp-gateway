import { describe, expect, it } from "vitest";
import { BOX_H, BOX_W, restingDiscs, slotCenter, tiltAt } from "./tool-wheel";

describe("the tool wheel's geometry", () => {
  it("puts the bottom slot under the hub, on the box's center line", () => {
    const { x, y } = slotCenter(0);
    expect(x).toBeCloseTo(469);
    expect(y).toBeCloseTo(560.5);
  });

  it("mirrors the slots either side of the bottom one", () => {
    for (const off of [1, 2, 3, 4, 5]) {
      const left = slotCenter(off);
      const right = slotCenter(-off);
      expect(left.x + right.x).toBeCloseTo(2 * 469);
      expect(left.y).toBeCloseTo(right.y);
    }
  });
});

describe("the tilt of a disc", () => {
  it("is tilted on the wheel and exactly flat at rest in the bottom slot", () => {
    expect(tiltAt(0)).toBeCloseTo(0.78);
    expect(tiltAt(1)).toBe(1);
  });

  it("is already flat at 85 percent of the grow, so no sliver of wall shows at rest", () => {
    expect(tiltAt(0.85)).toBe(1);
    expect(tiltAt(0.84)).toBeLessThan(1);
  });

  it("only flattens as the disc grows", () => {
    let last = tiltAt(0);
    for (let g = 0.05; g <= 1.0001; g += 0.05) {
      const now = tiltAt(g);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });
});

describe("the wheel drawn as markup, before the canvas", () => {
  it("shows every tool once when eleven ride the wheel, the first in the bottom slot", () => {
    const discs = restingDiscs(11);
    expect(discs.map((d) => d.index).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const front = discs.filter((d) => d.front);
    expect(front).toHaveLength(1);
    expect(front[0].index).toBe(0);
    expect(front[0].left).toBeCloseTo(469 / BOX_W);
    expect(front[0].top).toBeCloseTo(560.5 / BOX_H);
  });

  it("never repeats a tool when fewer ride it, and never shows more than the box holds", () => {
    expect(new Set(restingDiscs(4).map((d) => d.index)).size).toBe(4);
    expect(restingDiscs(30)).toHaveLength(11);
  });
});
