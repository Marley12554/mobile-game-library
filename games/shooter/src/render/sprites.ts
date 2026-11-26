/**
 * Pre-drawn blob figures. Each unit type is drawn once per walk frame (and once
 * flashed white) to an offscreen canvas, then stamped every frame.
 *
 * Figures are drawn in a 3/4 view standing on their position: feet at the
 * anchor, head above. Squad faces away (gun visible), enemies face the camera.
 */
import type { EnemyKind } from '../game/types';

export interface Sprite {
  c: HTMLCanvasElement;
  /** Size in world units. */
  w: number;
  h: number;
  /** Anchor (feet) offset from the top-left, world units. */
  ax: number;
  ay: number;
}

/** Pixels per world unit in the cached sprite. */
const PX = 5;

export interface Look {
  body: string;
  dark: string;
  light: string;
  feature: 'gun' | 'arms' | 'lean' | 'helmet' | 'bulb' | 'shield' | 'mask' | 'horns' | 'none';
}

export const LOOKS: Record<EnemyKind | 'soldier' | 'heavy', Look> = {
  soldier: { body: '#3d8bff', dark: '#1a4ab0', light: '#9cc8ff', feature: 'gun' },
  heavy: { body: '#2f6fe0', dark: '#163b8f', light: '#8ab6ff', feature: 'helmet' },
  zombie: { body: '#e0464c', dark: '#8f1c22', light: '#ff8f90', feature: 'arms' },
  runner: { body: '#ff6d3a', dark: '#a8381a', light: '#ffb08f', feature: 'lean' },
  armored: { body: '#d63c43', dark: '#7d1a1f', light: '#ff8a8c', feature: 'helmet' },
  splitter: { body: '#c9356f', dark: '#74163c', light: '#f58ab3', feature: 'bulb' },
  splitling: { body: '#de4f88', dark: '#7f1d48', light: '#ffa3c6', feature: 'arms' },
  shielded: { body: '#d9434a', dark: '#851d22', light: '#ff8d8f', feature: 'shield' },
  thief: { body: '#e24a3b', dark: '#8a2216', light: '#ff9a8c', feature: 'mask' },
  brute: { body: '#a92a30', dark: '#5a1013', light: '#e0676b', feature: 'horns' },
};

function canvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = Math.ceil(w * PX);
  c.height = Math.ceil(h * PX);
  return c;
}

function figure(g: CanvasRenderingContext2D, r: number, look: Look, frame: number, white: boolean): void {
  const fill = (c: string) => (g.fillStyle = white ? '#ffffff' : c);
  const line = r * 0.16;
  g.lineJoin = 'round';
  g.lineCap = 'round';
  g.strokeStyle = white ? '#ffffff' : look.dark;
  g.lineWidth = line;

  // shadow
  g.fillStyle = 'rgba(20,30,60,0.22)';
  g.beginPath();
  g.ellipse(0, 0, r * 1.05, r * 0.38, 0, 0, Math.PI * 2);
  g.fill();

  const lean = look.feature === 'lean' ? r * 0.25 : 0;
  // legs
  const legY = frame === 0 ? [0, -0.22] : [-0.22, 0];
  for (let s = 0; s < 2; s++) {
    const lx = (s === 0 ? -0.38 : 0.38) * r;
    fill(look.dark);
    g.beginPath();
    g.roundRect(lx - r * 0.22, -r * 0.85 + legY[s] * r, r * 0.44, r * 0.85, r * 0.2);
    g.fill();
  }
  // body
  const bodyR = look.feature === 'bulb' ? 0.95 : look.feature === 'horns' ? 0.85 : 0.75;
  fill(look.body);
  g.beginPath();
  g.ellipse(lean * 0.5, -r * 1.3, r * bodyR, r * 0.72, 0, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // head
  const hx = lean, hy = -r * 2.25;
  g.beginPath();
  g.arc(hx, hy, r * 0.56, 0, Math.PI * 2);
  g.fill();
  g.stroke();
  // highlight
  if (!white) {
    g.fillStyle = look.light;
    g.globalAlpha = 0.55;
    g.beginPath();
    g.ellipse(hx - r * 0.18, hy - r * 0.2, r * 0.2, r * 0.14, -0.5, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.ellipse(-r * 0.28 + lean * 0.5, -r * 1.55, r * 0.28, r * 0.18, -0.5, 0, Math.PI * 2);
    g.fill();
    g.globalAlpha = 1;
  }

  const metal = white ? '#ffffff' : '#a9b3c1';
  const metalDark = white ? '#ffffff' : '#5d6673';
  switch (look.feature) {
    case 'gun':
      g.fillStyle = white ? '#fff' : '#2a2f3a';
      g.beginPath();
      g.roundRect(r * 0.32, -r * 3.0, r * 0.26, r * 1.4, r * 0.1);
      g.fill();
      break;
    case 'arms':
      g.strokeStyle = white ? '#fff' : look.body;
      g.lineWidth = r * 0.34;
      g.beginPath();
      g.moveTo(-r * 0.62, -r * 1.55); g.lineTo(-r * 0.78, -r * 0.95 + (frame ? r * 0.12 : 0));
      g.moveTo(r * 0.62, -r * 1.55); g.lineTo(r * 0.78, -r * 0.95 + (frame ? 0 : r * 0.12));
      g.stroke();
      // dark eye slits: simple features that mark the undead
      if (!white) {
        g.fillStyle = look.dark;
        g.fillRect(hx - r * 0.3, hy - r * 0.02, r * 0.2, r * 0.1);
        g.fillRect(hx + r * 0.1, hy - r * 0.02, r * 0.2, r * 0.1);
      }
      break;
    case 'lean':
      g.strokeStyle = white ? '#fff' : look.body;
      g.lineWidth = r * 0.3;
      g.beginPath();
      g.moveTo(lean - r * 0.55, -r * 1.5); g.lineTo(lean - r * 0.9, -r * 1.0);
      g.moveTo(lean + r * 0.55, -r * 1.5); g.lineTo(lean + r * 0.95, -r * 1.85);
      g.stroke();
      break;
    case 'helmet':
      g.fillStyle = metal;
      g.strokeStyle = metalDark;
      g.lineWidth = line;
      g.beginPath();
      g.arc(hx, hy, r * 0.62, Math.PI, 0);
      g.lineTo(hx + r * 0.62, hy + r * 0.08);
      g.lineTo(hx - r * 0.62, hy + r * 0.08);
      g.closePath();
      g.fill();
      g.stroke();
      g.beginPath();
      g.roundRect(-r * 0.6, -r * 1.75, r * 1.2, r * 0.75, r * 0.2);
      g.fill();
      g.stroke();
      break;
    case 'bulb':
      g.strokeStyle = white ? '#fff' : look.dark;
      g.lineWidth = line;
      g.beginPath();
      g.moveTo(0, -r * 1.95); g.lineTo(0, -r * 0.65);
      g.stroke();
      if (!white) {
        g.fillStyle = look.light;
        for (const [x, y] of [[-0.5, -1.0], [0.45, -1.55], [0.5, -0.95]]) {
          g.beginPath(); g.arc(x * r, y * r, r * 0.13, 0, Math.PI * 2); g.fill();
        }
      }
      break;
    case 'shield':
      g.fillStyle = white ? '#fff' : '#6f8fb3';
      g.strokeStyle = white ? '#fff' : '#2c425c';
      g.lineWidth = line;
      g.beginPath();
      g.roundRect(-r * 0.85, -r * 1.85, r * 1.7, r * 1.45, r * 0.25);
      g.fill();
      g.stroke();
      if (!white) {
        g.fillStyle = '#b6cbe3';
        g.fillRect(-r * 0.6, -r * 1.65, r * 0.25, r * 1.05);
      }
      break;
    case 'mask':
      g.fillStyle = white ? '#fff' : '#ffd23c';
      g.fillRect(hx - r * 0.58, hy - r * 0.16, r * 1.16, r * 0.3);
      g.fillStyle = white ? '#fff' : '#c79a2b';
      g.beginPath();
      g.arc(r * 0.75, -r * 1.05, r * 0.42, 0, Math.PI * 2);
      g.fill();
      break;
    case 'horns':
      g.fillStyle = white ? '#fff' : '#f3e4c4';
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(hx + s * r * 0.35, hy - r * 0.35);
        g.lineTo(hx + s * r * 0.75, hy - r * 0.95);
        g.lineTo(hx + s * r * 0.55, hy - r * 0.2);
        g.closePath();
        g.fill();
      }
      break;
  }
}

const cache = new Map<string, Sprite>();

/** Sprite for a unit of collision radius r. frame 0/1 walk cycle. */
export function unitSprite(key: keyof typeof LOOKS, r: number, frame: number, white = false): Sprite {
  const id = `${key}|${r}|${frame}|${white ? 1 : 0}`;
  let s = cache.get(id);
  if (s) return s;
  const w = r * 2.8, h = r * 3.6;
  const c = canvas(w, h);
  const g = c.getContext('2d')!;
  g.scale(PX, PX);
  g.translate(w / 2, h - r * 0.45);
  figure(g, r, LOOKS[key], frame, white);
  s = { c, w, h, ax: w / 2, ay: h - r * 0.45 };
  cache.set(id, s);
  return s;
}
