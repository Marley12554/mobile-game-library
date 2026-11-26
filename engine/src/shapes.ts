import { cos, sin, TAU } from './dmath';
import type { PieceDef } from './world';

/** A gap in a ring: centered at `at` (radians), `width` radians wide. */
export interface Gap {
  at: number;
  width: number;
}

/** Ring centered on the collider origin, with zero or more gaps. Returns the solid arcs. */
export function ring(radius: number, halfThickness: number, gaps: Gap[] = []): PieceDef[] {
  if (gaps.length === 0) return [{ kind: 'arc', radius, start: 0, span: TAU, halfThickness }];
  // Normalize gaps to [start, end) in [0, TAU) and sort.
  const gs = gaps
    .map((g) => {
      let s = (g.at - g.width / 2) % TAU;
      if (s < 0) s += TAU;
      return { s, w: Math.min(g.width, TAU) };
    })
    .sort((a, b) => a.s - b.s);
  const pieces: PieceDef[] = [];
  for (let k = 0; k < gs.length; k++) {
    const end = gs[k].s + gs[k].w;
    const next = k + 1 < gs.length ? gs[k + 1].s : gs[0].s + TAU;
    const span = next - end;
    if (span > 1e-9) pieces.push({ kind: 'arc', radius, start: end, span, halfThickness });
  }
  return pieces;
}

export function segment(ax: number, ay: number, bx: number, by: number, halfThickness = 1): PieceDef {
  return { kind: 'segment', ax, ay, bx, by, halfThickness };
}

/** Open or closed polyline from a flat [x0,y0,x1,y1,...] list. */
export function polyline(pts: number[], halfThickness = 1, closed = false): PieceDef[] {
  const out: PieceDef[] = [];
  const n = pts.length / 2;
  const m = closed ? n : n - 1;
  for (let k = 0; k < m; k++) {
    const a = k * 2, b = ((k + 1) % n) * 2;
    out.push(segment(pts[a], pts[a + 1], pts[b], pts[b + 1], halfThickness));
  }
  return out;
}

/** Axis-aligned box outline centered on the origin. */
export function box(w: number, h: number, halfThickness = 1): PieceDef[] {
  const x = w / 2, y = h / 2;
  return polyline([-x, -y, x, -y, x, y, -x, y], halfThickness, true);
}

/**
 * Archimedean spiral r = r0 + growth * theta, from theta 0 to `turns` turns.
 * `step` is the angular resolution in radians.
 */
export function spiral(r0: number, growth: number, turns: number, halfThickness = 1, step = 0.08): PieceDef[] {
  const pts: number[] = [];
  const end = turns * TAU;
  for (let t = 0; t <= end + 1e-9; t += step) {
    const r = r0 + growth * t;
    pts.push(cos(t) * r, sin(t) * r);
  }
  return polyline(pts, halfThickness);
}
