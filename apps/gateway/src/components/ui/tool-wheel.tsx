"use client";

// Tool Wheel by Louis Studios.
// 220 more hand-made React components at https://studios.lou15.com/?ref=21st-code
//
// Published at https://21st.dev/@louisstudios/components/tool-wheel under the
// MIT license; the notice is in THIRD_PARTY_NOTICES.md at the repository root.
// This copy is modified: real logo images in place of single-path icons, glass
// discs that tilt toward the wheel's center, two canvases so the discs are
// redrawn only while they move, a markup fallback under the canvas, and the
// author's heading block, frame, code glyphs, default icons, and controlled
// mode removed.

import React, { useCallback, useEffect, useRef, useState } from "react";

/** One tool on the wheel. */
export interface ToolWheelItem {
  /** Name of the tool, read out to screen readers when it comes to the front. */
  label: string;
  /** Image URL of the tool's logo. */
  src: string;
}

export interface ToolWheelProps {
  /** Tools riding the wheel, in order. Keep the array's identity stable between renders. */
  items: readonly ToolWheelItem[];
  /** Image URL for the mark in the hub. */
  markSrc: string;
  /** Name of the wheel for assistive technology. */
  label: string;
  /** Called with the new index whenever a tool settles into the bottom slot. */
  onActiveChange?: (index: number) => void;
  /** Hold the wheel still, for a reader who is on something that names the front tool. */
  paused?: boolean;
  /** Seconds between steps; the signal loops once per step. */
  interval?: number;
  /** The travelling signal. */
  signal?: string;
  /** Hairlines: the wheel, the connector, and the two rings. */
  lineColor?: string;
  /** Under each disc: a blue glow for a dark page, or a small neutral shadow for a light one. */
  shadow?: "glow" | "soft";
  /** The keyboard focus ring. */
  focusColor?: string;
  /** Class on the root element. */
  className?: string;
}

// Geometry in design units: a 939 x 698 box.
export const BOX_W = 939;
export const BOX_H = 698;
const CX = 469;
const RING_CY = 180;
const RING_R = 391;
const SLOT_DEG = 25.58;
const HUB_CY = 347;
const FOCUS_CY = 560.5;
const DISC_R = 36;
const BIG = 1.735;
const HUB_R = 62.5;
const HALO_R = 69.5;
const PULL = 10.5;
const ICON = 32;
const MARK = 62;
/** Slots either side of the bottom one that fall inside the box. */
const REACH = 5;

// Timing measured from the author's reference at 30 fps.
const ROT_DUR = 14.53 / 30;
const ROT_LEAD = (66 - 50.93) / 30;
const SWITCH_AT = 0.518;
const SCALE_DUR = 9.5 / 30;
const COMET_LEN = 30;

/** How far a disc on the wheel is squashed along its radial axis: 1 is face-on. */
const TILT = 0.78;
/** The share of the grow at which the arriving disc is already flat, so it rests exactly face-on. */
const FLAT_AT = 0.85;

type Tween = { from: number; to: number; start: number };

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeInOutQuad = (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Center of the slot `off` steps from the bottom one, in design units. */
export function slotCenter(off: number): { x: number; y: number } {
  const deg = 90 + off * SLOT_DEG;
  const dd = Math.abs(deg - 90);
  const pull = PULL * Math.max(0, 1 - (dd / 12) * (dd / 12));
  const a = (deg * Math.PI) / 180;
  const r = RING_R - pull;
  return { x: CX + r * Math.cos(a), y: RING_CY + r * Math.sin(a) };
}

/** The squash of a disc at `grow` (0 on the wheel, 1 grown into the bottom slot): tilted, then flat from `FLAT_AT` on. */
export function tiltAt(grow: number): number {
  return TILT + (1 - TILT) * Math.min(1, clamp01(grow) / FLAT_AT);
}

/** The discs as they rest with `items[0]` in the bottom slot, as shares of the box: the markup drawn before the canvas is. */
export function restingDiscs(count: number): { index: number; left: number; top: number; size: number; front: boolean }[] {
  const shown = Math.min(count, 2 * REACH + 1);
  const first = -Math.floor((shown - 1) / 2);
  return Array.from({ length: shown }, (_, i) => {
    const off = first + i;
    const { x, y } = slotCenter(off);
    const front = off === 0;
    return { index: mod(off, count), left: x / BOX_W, top: y / BOX_H, size: (2 * DISC_R * (front ? BIG : 1)) / BOX_W, front };
  });
}

/** The markup and the canvases cross-fade once every logo has settled. */
const FADE = "opacity .2s linear";
const CANVAS: React.CSSProperties = { position: "absolute", inset: 0, width: "100%", height: "100%", pointerEvents: "none", transition: FADE };

const FACE: React.CSSProperties = {
  position: "absolute",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  aspectRatio: "1",
  borderRadius: "50%",
  background: "#fff",
  transform: "translate(-50%, -50%)",
};

export function ToolWheel({
  items,
  markSrc,
  label,
  onActiveChange,
  paused = false,
  interval = 2.8,
  signal = "#2D5BD6",
  lineColor = "#E7E5E4",
  shadow = "glow",
  focusColor = "#1C1917",
  className,
}: ToolWheelProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const discsRef = useRef<HTMLCanvasElement | null>(null);
  const signalRef = useRef<HTMLCanvasElement | null>(null);
  /** The box in CSS pixels and the device's pixel ratio (capped at 3): the canvases are sized from all three. */
  const [size, setSize] = useState({ w: 0, h: 0, dpr: 1 });
  const [announce, setAnnounce] = useState("");
  const [focusRing, setFocusRing] = useState(false);
  /** Bumped as each image settles; the discs are redrawn with it. */
  const [settled, setSettled] = useState(0);
  const n = Math.max(1, items.length);

  const live = useRef({
    T: 0,
    last: -1,
    rot0: 0,
    rot1: 0,
    animStart: -1,
    animDur: ROT_DUR,
    nextStepAt: interval - ROT_LEAD,
    manualEnd: -10,
    shown: 0,
    scales: new Map<number, Tween>([[0, { from: 1, to: 1, start: -1 }]]),
    hover: false,
    focus: false,
    /** The turn under way was asked for (a key, a click), not the wheel's own step. */
    manual: false,
    onscreen: true,
    reduced: false,
    dirty: true,
  });

  const props = useRef({ items, n, interval, onActiveChange, paused, painted: false, signal, lineColor, shadow });

  // The mark, then each tool's logo. Loaded in an effect, never in render: a cached image settles at once, and a
  // state update from render lands on a component that has not mounted.
  const [images, setImages] = useState<HTMLImageElement[]>([]);
  useEffect(() => {
    let current = true;
    setSettled(0);
    setImages(
      [markSrc, ...items.map((it) => it.src)].map((src) => {
        const im = new Image();
        im.onload = im.onerror = () => current && setSettled((c) => c + 1);
        im.src = src;
        return im;
      })
    );
    return () => {
      current = false;
    };
  }, [items, markSrc]);
  /** The canvases take over from the markup, and the wheel starts to step, once every logo has loaded or failed: no
   * disc is shown empty, and nothing turns over the markup. */
  const painted = size.w > 0 && images.length > 0 && settled >= images.length;
  props.current = { items, n, interval, onActiveChange, paused, painted, signal, lineColor, shadow };

  const rotAt = (T: number) => {
    const L = live.current;
    if (L.animStart < 0 || T >= L.animStart + L.animDur) return L.rot1;
    if (T <= L.animStart) return L.rot0;
    return L.rot0 + (L.rot1 - L.rot0) * ((T - L.animStart) / L.animDur);
  };
  const growOf = (j: number, T: number) => {
    const L = live.current;
    const tw = L.scales.get(j);
    if (!tw) return 0;
    const d = L.reduced ? 0 : SCALE_DUR;
    const p = d <= 0 ? 1 : easeInOutQuad(clamp01((T - tw.start) / d));
    return tw.from + (tw.to - tw.from) * p;
  };

  const goTo = useCallback((target: number) => {
    const L = live.current;
    const { n: count } = props.current;
    const cur = L.rot1;
    let delta = mod(target - mod(cur, count), count);
    if (delta > count / 2) delta -= count;
    if (delta === 0) return;
    const now = L.T;
    const from = rotAt(now);
    L.rot0 = from;
    L.rot1 = cur + delta;
    L.animStart = now;
    L.animDur = L.reduced ? 0.0001 : ROT_DUR * Math.sqrt(Math.abs(L.rot1 - from));
    L.manualEnd = now + L.animDur;
    L.manual = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Size.
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const measure = () => {
      const next = { w: el.clientWidth, h: el.clientHeight, dpr: Math.min(3, window.devicePixelRatio || 1) };
      setSize((prev) => (prev.w === next.w && prev.h === next.h && prev.dpr === next.dpr ? prev : next));
    };
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // A zoom, or a move to another screen, changes the pixel ratio without always changing the box.
    window.addEventListener("resize", measure);
    measure();
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);

  // Reduced motion, visibility.
  useEffect(() => {
    const L = live.current;
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)") ?? null;
    const upd = () => {
      L.reduced = !!mq?.matches;
      L.dirty = true;
    };
    upd();
    mq?.addEventListener?.("change", upd);
    let io: IntersectionObserver | null = null;
    if (rootRef.current && typeof IntersectionObserver !== "undefined") {
      io = new IntersectionObserver((es) => (L.onscreen = es[es.length - 1].isIntersecting));
      io.observe(rootRef.current);
    }
    return () => {
      mq?.removeEventListener?.("change", upd);
      io?.disconnect();
    };
  }, []);

  const layout = (w: number, h: number) => {
    const k = Math.min(w / BOX_W, h / BOX_H);
    return { k, ox: (w - BOX_W * k) / 2, oy: (h - BOX_H * k) / 2 };
  };

  // Disc centers for drawing and hit testing, smallest first so the grown one is drawn last.
  const placeItems = (T: number) => {
    const rot = rotAt(T);
    const out: { j: number; x: number; y: number; grow: number }[] = [];
    for (let j = Math.floor(rot) - REACH - 1; j <= Math.ceil(rot) + REACH + 1; j++) {
      const off = j - rot;
      if (Math.abs(off) > REACH + 0.6) continue;
      out.push({ j, ...slotCenter(off), grow: growOf(j, T) });
    }
    out.sort((p, q) => p.grow - q.grow);
    return out;
  };

  // Render loop. The discs are costly to draw (a wall of gradient fills and a blurred shadow each) and still for most
  // of every step, so they have their own canvas, redrawn only while something on it moves. The signal moves every
  // frame and is a dozen short strokes on a canvas of its own.
  useEffect(() => {
    const discs = discsRef.current;
    const sig = signalRef.current;
    if (!discs || !sig || size.w === 0 || size.h === 0) return;
    const ctx = discs.getContext("2d");
    const sctx = sig.getContext("2d");
    if (!ctx || !sctx) return;
    const dpr = size.dpr;
    for (const cv of [discs, sig]) {
      cv.width = Math.round(size.w * dpr);
      cv.height = Math.round(size.h * dpr);
    }
    const { k, ox, oy } = layout(size.w, size.h);
    const X = (x: number) => ox + x * k;
    const Y = (y: number) => oy + y * k;
    const L = live.current;
    L.dirty = true;
    let raf = 0;

    const commitActive = (T: number) => {
      const rot = rotAt(T);
      const next = Math.floor(rot + (1 - SWITCH_AT));
      while (L.shown !== next) {
        const dir = next > L.shown ? 1 : -1;
        const to = L.shown + dir;
        const cross = dir > 0 ? to - (1 - SWITCH_AT) : L.shown - (1 - SWITCH_AT);
        let tc = T;
        if (L.animStart >= 0 && L.rot1 !== L.rot0) tc = L.animStart + L.animDur * ((cross - L.rot0) / (L.rot1 - L.rot0));
        if (!(tc <= T)) tc = T;
        const prev = L.shown;
        L.scales.set(prev, { from: growOf(prev, tc), to: 0, start: tc });
        L.scales.set(to, { from: growOf(to, tc), to: 1, start: tc });
        L.shown = to;
        const idx = mod(to, props.current.n);
        props.current.onActiveChange?.(idx);
        // Only a turn the reader asked for is announced: the wheel's own steps would talk over the page every few seconds.
        if (L.manual) setAnnounce(`${props.current.items[idx]?.label ?? ""}, ${idx + 1} of ${props.current.n}`);
      }
      for (const [j, tw] of L.scales) if (tw.to === 0 && T - tw.start > SCALE_DUR + 0.05) L.scales.delete(j);
    };

    /** Whether anything on the disc canvas is between two states at `T`. */
    const moving = (T: number) => {
      if (L.animStart >= 0 && T < L.animStart + L.animDur) return true;
      for (const tw of L.scales.values()) if (tw.from !== tw.to && T - tw.start < SCALE_DUR) return true;
      return false;
    };

    // A thick glass puck seen at an angle: squashed by `c` along the axis `a`, with its side wall showing on that side.
    const disc = (x: number, y: number, r: number, a: number, c: number) => {
      const soft = props.current.shadow === "soft";
      const ux = Math.cos(a);
      const uy = Math.sin(a);
      const depth = (r * 0.3 * Math.sqrt(1 - c * c)) / 0.6;
      const tilt = (px: number, py: number) => {
        ctx.translate(px, py);
        ctx.rotate(a);
        ctx.scale(c, 1);
        ctx.rotate(-a);
      };
      ctx.save();
      // Face-on there is no wall to stack: one fill carries the shadow.
      const steps = depth < 0.5 ? 1 : Math.max(4, Math.ceil(depth));
      for (let i = steps; i >= 1; i--) {
        const o = (depth * i) / steps;
        ctx.save();
        tilt(x + ux * o, y + uy * o);
        const wall = ctx.createLinearGradient(-r, -r, r, r);
        wall.addColorStop(0, "#9DBCFF");
        wall.addColorStop(0.45, "#2D5BD6");
        wall.addColorStop(1, "#0B2478");
        ctx.fillStyle = wall;
        if (i === steps) {
          ctx.shadowColor = soft ? "rgba(28, 25, 23, 0.16)" : "rgba(18, 52, 190, 0.6)";
          ctx.shadowBlur = r * (soft ? 0.22 : 0.6) * dpr;
          ctx.shadowOffsetX = soft ? 0 : ux * r * 0.14 * dpr;
          ctx.shadowOffsetY = soft ? r * 0.08 * dpr : (uy * r * 0.14 + r * 0.12) * dpr;
        }
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fill();
        if (i === steps && depth > 0.75) {
          ctx.shadowColor = "transparent";
          ctx.rotate(a);
          ctx.beginPath();
          ctx.arc(0, 0, r * 0.97, -1.15, 1.15);
          ctx.strokeStyle = "rgba(185, 210, 255, 0.7)";
          ctx.lineWidth = Math.max(1, r * 0.035);
          ctx.stroke();
        }
        ctx.restore();
      }
      tilt(x, y);
      // Face: frosted and pale, so a full-color logo stays readable on it.
      const face = ctx.createRadialGradient(-r * 0.38, -r * 0.5, r * 0.08, 0, 0, r * 1.08);
      face.addColorStop(0, "rgba(255, 255, 255, 1)");
      face.addColorStop(0.55, "rgba(236, 243, 255, 0.97)");
      face.addColorStop(1, "rgba(150, 184, 255, 0.95)");
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      ctx.fillStyle = face;
      ctx.fill();
      // Inner bevel.
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.88, 0, Math.PI * 2);
      ctx.strokeStyle = "rgba(45, 91, 214, 0.18)";
      ctx.lineWidth = Math.max(0.75, r * 0.025);
      ctx.stroke();
      // Rim.
      const rim = ctx.createLinearGradient(-r, -r, r, r);
      rim.addColorStop(0, "rgba(255, 255, 255, 1)");
      rim.addColorStop(0.5, "rgba(190, 212, 255, 0.9)");
      rim.addColorStop(1, "rgba(70, 118, 235, 0.9)");
      ctx.beginPath();
      ctx.arc(0, 0, r - Math.max(0.5, r * 0.02), 0, Math.PI * 2);
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1, r * 0.05);
      ctx.stroke();
      // Highlight.
      ctx.beginPath();
      ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2);
      ctx.clip();
      const hl = ctx.createLinearGradient(0, -r, 0, -r * 0.05);
      hl.addColorStop(0, "rgba(255, 255, 255, 0.85)");
      hl.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.beginPath();
      ctx.ellipse(-r * 0.12, -r * 0.7, r * 0.8, r * 0.5, -0.3, 0, Math.PI * 2);
      ctx.fillStyle = hl;
      ctx.fill();
      ctx.restore();
    };

    /** An image fitted in a `box` square centered on the current origin. */
    const fit = (im: HTMLImageElement | undefined, box: number) => {
      if (!im || !im.complete || im.naturalWidth === 0) return;
      const ar = im.naturalWidth / im.naturalHeight;
      const w = ar >= 1 ? box : box * ar;
      const h = ar >= 1 ? box / ar : box;
      ctx.drawImage(im, -w / 2, -h / 2, w, h);
    };

    const drawDiscs = (T: number) => {
      const P = props.current;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size.w, size.h);

      // Wheel, connector, and the rings around the hub and the bottom slot.
      ctx.strokeStyle = P.lineColor;
      ctx.lineWidth = Math.max(1, k);
      ctx.beginPath();
      ctx.arc(X(CX), Y(RING_CY), RING_R * k, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(X(CX), Y(HUB_CY + HALO_R));
      ctx.lineTo(X(CX), Y(FOCUS_CY - HALO_R));
      ctx.stroke();
      for (const cy of [HUB_CY, FOCUS_CY]) {
        ctx.beginPath();
        ctx.arc(X(CX), Y(cy), HALO_R * k, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Tools, each tilted along its own radial axis, the logo with its disc.
      for (const it of placeItems(T)) {
        const x = X(it.x);
        const y = Y(it.y);
        const s = 1 + (BIG - 1) * it.grow;
        const r = DISC_R * s * k;
        if (y + r * 1.4 < 0) continue;
        const a = Math.atan2(it.y - RING_CY, it.x - CX);
        const c = tiltAt(it.grow);
        disc(x, y, r, a, c);
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(a);
        ctx.scale(c, 1);
        ctx.rotate(-a);
        fit(images[1 + mod(it.j, P.n)], ICON * s * k);
        ctx.restore();
      }

      // Hub: flat, face-on, no wall.
      disc(X(CX), Y(HUB_CY), HUB_R * k, Math.PI / 2, 1);
      ctx.save();
      ctx.translate(X(CX), Y(HUB_CY));
      fit(images[0], MARK * k);
      ctx.restore();
    };

    // The signal: hub ring, connector, slot ring, connector.
    const LOOP = 2 * Math.PI * HALO_R;
    const SEG = FOCUS_CY - HALO_R - (HUB_CY + HALO_R);
    const TOTAL = 2 * LOOP + 2 * SEG;
    const at = (s: number): [number, number] => {
      s = mod(s, TOTAL);
      if (s < LOOP) {
        const th = Math.PI / 2 - s / HALO_R;
        return [CX + HALO_R * Math.cos(th), HUB_CY + HALO_R * Math.sin(th)];
      }
      s -= LOOP;
      if (s < SEG) return [CX, HUB_CY + HALO_R + s];
      s -= SEG;
      if (s < LOOP) {
        const th = -Math.PI / 2 + s / HALO_R;
        return [CX + HALO_R * Math.cos(th), FOCUS_CY + HALO_R * Math.sin(th)];
      }
      s -= LOOP;
      return [CX, FOCUS_CY - HALO_R - s];
    };
    const drawSignal = (T: number) => {
      const P = props.current;
      sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      sctx.clearRect(0, 0, size.w, size.h);
      if (L.reduced) return;
      const head = (mod(T, P.interval) / P.interval) * TOTAL + 3;
      sctx.strokeStyle = P.signal;
      sctx.lineWidth = Math.max(0.8, 1.25 * k);
      sctx.lineCap = "round";
      const steps = 12;
      for (let i = 0; i < steps; i++) {
        const s0 = head - COMET_LEN + (COMET_LEN * i) / steps;
        const s1 = head - COMET_LEN + (COMET_LEN * (i + 1)) / steps;
        const u = (i + 0.5) / steps;
        sctx.globalAlpha = 0.9 * Math.min(1, Math.sin(Math.PI * Math.min(1, u * 1.15)) * 1.6);
        const [ax, ay] = at(s0);
        const [bx, by] = at((s0 + s1) / 2);
        const [cx2, cy2] = at(s1);
        sctx.beginPath();
        sctx.moveTo(X(ax), Y(ay));
        sctx.quadraticCurveTo(X(2 * bx - (ax + cx2) / 2), Y(2 * by - (ay + cy2) / 2), X(cx2), Y(cy2));
        sctx.stroke();
      }
      sctx.globalAlpha = 1;
    };

    let wasMoving = true;
    const tick = () => {
      raf = requestAnimationFrame(tick);
      const now = performance.now() / 1000;
      if (L.last < 0) L.last = now;
      const dt = Math.min(0.1, Math.max(0, now - L.last));
      L.last = now;
      if (document.visibilityState === "hidden" || !L.onscreen) return;
      L.T += dt;
      const P = props.current;
      const T = L.T;
      // Still while a mouse rests on it, while it has keyboard focus, on request, and until the canvas has taken over.
      const held = L.hover || L.focus || L.reduced || P.paused || !P.painted;
      while (T >= L.nextStepAt) {
        const stepAt = L.nextStepAt;
        L.nextStepAt += P.interval;
        const rested = L.animStart < 0 || stepAt >= L.animStart + L.animDur;
        if (held || !rested || stepAt - L.manualEnd < P.interval * 0.6) continue;
        L.manual = false;
        L.rot0 = L.rot1;
        L.rot1 = L.rot1 + 1;
        L.animStart = stepAt;
        L.animDur = ROT_DUR;
      }
      commitActive(T);
      // One more frame after the last moving one, so the discs land on their resting state exactly.
      const isMoving = moving(T);
      if (isMoving || wasMoving || L.dirty) drawDiscs(T);
      wasMoving = isMoving;
      L.dirty = false;
      drawSignal(T);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size.w, size.h, size.dpr, images, settled, signal, lineColor, shadow]);

  const hit = (e: React.PointerEvent | React.MouseEvent) => {
    const el = rootRef.current;
    if (!el) return null;
    const rc = el.getBoundingClientRect();
    const { k, ox, oy } = layout(rc.width, rc.height);
    const px = (e.clientX - rc.left - ox) / k;
    const py = (e.clientY - rc.top - oy) / k;
    let best: number | null = null;
    for (const it of placeItems(live.current.T)) {
      if (Math.hypot(px - it.x, py - it.y) <= DISC_R * (1 + (BIG - 1) * it.grow) + 2) best = it.j;
    }
    return best;
  };

  const pct = (v: number) => `${(v * 100).toFixed(3)}%`;

  return (
    <div
      ref={rootRef}
      className={className}
      tabIndex={0}
      role="group"
      aria-roledescription="tool wheel"
      aria-label={label}
      onKeyDown={(e) => {
        // Left and right only, and never with a modifier: up and down scroll the page, Alt+Left goes back.
        if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (step === 0) return;
        e.preventDefault();
        goTo(mod(live.current.rot1 + step, n));
      }}
      onFocus={(e) => {
        // Keyboard focus only: a mouse click focuses the wheel too, and must not freeze it once the mouse has gone.
        const byKeyboard = e.currentTarget.matches(":focus-visible");
        live.current.focus = byKeyboard;
        setFocusRing(byKeyboard);
      }}
      onBlur={() => {
        live.current.focus = false;
        setFocusRing(false);
      }}
      onPointerEnter={(e) => (live.current.hover = e.pointerType === "mouse")}
      onPointerLeave={(e) => {
        live.current.hover = false;
        e.currentTarget.style.cursor = "default";
      }}
      onPointerMove={(e) => {
        e.currentTarget.style.cursor = hit(e) !== null ? "pointer" : "default";
      }}
      onClick={(e) => {
        const j = hit(e);
        if (j !== null) goTo(mod(j, n));
      }}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: `${BOX_W} / ${BOX_H}`,
        outline: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      {/* The wheel as markup, at rest: what a reader sees before the script runs or without it, and the list of
          tools a screen reader gets, since the canvases are hidden from it. It fades out under the canvas. */}
      <ul
        style={{ position: "absolute", inset: 0, margin: 0, padding: 0, listStyle: "none", pointerEvents: "none", opacity: painted ? 0 : 1, transition: FADE }}
      >
        {restingDiscs(items.length).map((d) => (
          <li key={d.index} style={{ ...FACE, left: pct(d.left), top: pct(d.top), width: pct(d.size) }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={items[d.index].src} alt={items[d.index].label} style={{ width: "44%", height: "44%", objectFit: "contain" }} />
          </li>
        ))}
        <li aria-hidden="true" style={{ ...FACE, left: pct(CX / BOX_W), top: pct(HUB_CY / BOX_H), width: pct((2 * HUB_R) / BOX_W) }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={markSrc} alt="" style={{ width: "50%", height: "50%", objectFit: "contain" }} />
        </li>
      </ul>
      <canvas ref={discsRef} aria-hidden="true" style={{ ...CANVAS, opacity: painted ? 1 : 0 }} />
      <canvas ref={signalRef} aria-hidden="true" style={{ ...CANVAS, opacity: painted ? 1 : 0 }} />
      {focusRing ? (
        <span
          aria-hidden="true"
          style={{
            ...FACE,
            left: pct(CX / BOX_W),
            top: pct(FOCUS_CY / BOX_H),
            width: pct((2 * (HALO_R + 4)) / BOX_W),
            background: "none",
            border: `2px solid ${focusColor}`,
            pointerEvents: "none",
          }}
        />
      ) : null}
      <div aria-live="polite" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)", whiteSpace: "nowrap" }}>
        {announce}
      </div>
    </div>
  );
}
