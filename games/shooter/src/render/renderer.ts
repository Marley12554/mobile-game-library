import { TRACK_HALF } from '../game/config';
import type { Sim, Gate, Prize } from '../game/sim';
import { ENEMIES } from '../game/enemies';
import { modLabel } from '../game/gates';
import { WEAPONS } from '../game/weapons';
import { unitSprite, LOOKS, type Sprite } from './sprites';
import { Particles, P_CHUNK, P_SPARK, P_RING, P_SHARD, P_SMOKE, type Pop } from './particles';
import type { Sound } from '../ui/audio';

const FONT = `'Fredoka', 'Baloo 2', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;

const TONE_FILL: Record<string, string> = {
  good: 'rgba(40,140,255,0.58)', bad: 'rgba(255,58,70,0.6)', mixed: 'rgba(255,170,30,0.62)', weapon: 'rgba(150,80,255,0.6)',
};
const TONE_EDGE: Record<string, string> = { good: '#bfe0ff', bad: '#ffc2c6', mixed: '#ffe2a8', weapon: '#dcc8ff' };
const TONE_POST: Record<string, string> = { good: '#1f5fd1', bad: '#c0262f', mixed: '#c77a00', weapon: '#6a2fd6' };
const TONE_TEXT: Record<string, string> = { good: '#4aa3ff', bad: '#ff4b55', mixed: '#ffb21e', weapon: '#a77bff', egg: '#ffd1e6' };

const BULLET_COLOR = ['#ffe45c', '#ffd36b', '#c6f6ff', '#ff9a3c', '#a9ecff', '#fff3a8'];
const BULLET_WIDTH = [2.2, 2.2, 2.6, 0, 3.4, 3.6];
const BULLET_TAIL = [0.022, 0.018, 0.045, 0, 0.03, 0.03];

const KILL_COLOR: Record<string, string> = {
  zombie: '#e0464c', runner: '#ff6d3a', armored: '#a9b3c1', splitter: '#c9356f', splitling: '#de4f88',
  shielded: '#6f8fb3', thief: '#ffd23c', brute: '#a92a30', egg: '#ffe3ef',
};

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  w = 360;
  h = 640;
  /** CSS px per world unit. */
  scale = 1;
  /** CSS px y of the squad line. */
  squadSY = 500;
  private shake = 0;
  private ox = 0;
  private oy = 0;
  private parts = new Particles();
  private pops: Pop[] = [];
  private realT = 0;
  private banner: { text: string; sub: string; t: number } | null = null;
  private order: number[] = [];
  private orderY: number[] = [];
  private cracks = new Map<Prize, number[][]>();
  sound: Sound | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
  }

  resize(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
    this.squadSY = this.h * 0.8;
    // Always show at least ~560 units ahead, and never wider than the track plus a margin.
    this.scale = Math.min(this.w / 360, this.squadSY / 560);
  }

  /** CSS px per world unit, used by input to map finger movement. */
  get pxPerUnit(): number { return this.scale; }

  showBanner(text: string, sub = ''): void { this.banner = { text, sub, t: 0 }; }

  private sx(x: number): number { return this.w / 2 + x * this.scale + this.ox; }
  private sy(y: number, camY: number): number { return this.squadSY - (y - camY) * this.scale + this.oy; }

  /* ------------------------------------------------------------------ */
  /* Events                                                              */
  /* ------------------------------------------------------------------ */

  consume(sim: Sim): void {
    const P = this.parts;
    const snd = this.sound;
    for (const f of sim.fx) {
      switch (f.t) {
        case 'hit':
          P.add(P_SPARK, f.x, f.y, (Math.random() - 0.5) * 120, -Math.random() * 80, 0.15, 2.2, BULLET_COLOR[f.v ?? 0]);
          snd?.play('hit');
          break;
        case 'spark':
          P.add(P_SPARK, f.x, f.y, (Math.random() - 0.5) * 100, -60, 0.12, 2, '#e9eef7');
          break;
        case 'shield':
          P.burst(P_SPARK, f.x, f.y, 2, 90, 0.15, 2, '#d7e7ff');
          snd?.play('clank');
          break;
        case 'clank':
          P.add(P_SPARK, f.x, f.y, (Math.random() - 0.5) * 140, (Math.random() - 0.5) * 140, 0.12, 2, '#ffffff');
          snd?.play('clank');
          break;
        case 'kill': {
          const c = KILL_COLOR[f.k ?? 'zombie'] ?? '#e0464c';
          const r = f.v ?? 6;
          P.burst(P_CHUNK, f.x, f.y + r, Math.min(10, 4 + r * 0.5), 60 + r * 6, 0.45, r * 0.45, c);
          P.add(P_RING, f.x, f.y + r, 0, 0, 0.22, r * 1.6, 'rgba(255,255,255,0.7)');
          snd?.play('kill');
          break;
        }
        case 'poof':
          P.burst(P_SMOKE, f.x, f.y + 5, 4, 40, 0.35, 4, 'rgba(255,255,255,0.6)');
          break;
        case 'down':
          P.burst(P_CHUNK, f.x, f.y + 4, 5, 70, 0.4, 2.4, '#3d8bff');
          snd?.play('down');
          break;
        case 'boom':
          P.add(P_RING, f.x, f.y, 0, 0, 0.35, (f.v ?? 30) * 1.1, 'rgba(255,220,120,0.9)');
          P.burst(P_SMOKE, f.x, f.y, 10, (f.v ?? 30) * 3, 0.55, 7, 'rgba(255,150,60,0.8)');
          P.burst(P_SPARK, f.x, f.y, 10, (f.v ?? 30) * 6, 0.3, 2.5, '#fff1a0');
          snd?.play('boom');
          break;
        case 'shake':
          this.shake = Math.max(this.shake, f.v ?? 4);
          if ((f.v ?? 0) >= 8) navigator.vibrate?.(30);
          break;
        case 'gate': {
          const tone = f.k ?? 'good';
          const d = f.v ?? 0;
          const text = d !== 0 ? (d > 0 ? `+${d}` : `${d}`) : (f.s ?? '');
          this.pop(f.x, f.y + 40, text, TONE_TEXT[tone], 34);
          if (d === 0 && f.s && text !== f.s) this.pop(f.x, f.y + 10, f.s, TONE_TEXT[tone], 18);
          P.burst(P_SHARD, f.x, f.y + 10, 14, 160, 0.5, 4, TONE_EDGE[tone]);
          snd?.play(tone === 'bad' ? 'gateBad' : 'gateGood');
          break;
        }
        case 'gateUp':
          snd?.play('tick');
          break;
        case 'stolen':
          this.pop(f.x, f.y + 30, 'STOLEN!', TONE_TEXT.bad, 22);
          P.burst(P_SHARD, f.x, f.y + 10, 10, 120, 0.4, 3, '#ffc2c6');
          snd?.play('gateBad');
          break;
        case 'ice':
          P.add(P_SHARD, f.x, f.y, (Math.random() - 0.5) * 120, -Math.random() * 90, 0.35, 2.6, '#e8fbff');
          snd?.play('ice');
          break;
        case 'prize':
          P.burst(P_SHARD, f.x, f.y, 46, 300, 0.8, 6, '#dff7ff');
          P.burst(P_SHARD, f.x, f.y, 20, 180, 0.6, 4, '#9fdcff');
          P.add(P_RING, f.x, f.y, 0, 0, 0.45, 90, 'rgba(200,245,255,0.95)');
          snd?.play('shatter');
          break;
        case 'prizeLost':
          this.pop(f.x, f.y + 20, 'MISSED', '#c9d6e8', 20);
          break;
        case 'pop':
          this.pop(f.x, f.y, f.s ?? '', TONE_TEXT[f.k ?? 'good'] ?? '#fff', 26);
          break;
        case 'splat':
          P.burst(P_CHUNK, f.x, f.y, 8, 80, 0.4, 3, '#f7c4dc');
          break;
        case 'slam':
          P.burst(P_SMOKE, f.x, f.y, 16, 200, 0.6, 9, 'rgba(180,160,140,0.8)');
          snd?.play('boom');
          break;
        case 'bossIn':
          this.showBanner(f.s ?? 'BOSS', 'Learn the pattern');
          snd?.play('roar');
          break;
        case 'bossDown':
          P.burst(P_CHUNK, f.x, f.y, 40, 300, 0.9, 7, '#e0464c');
          P.add(P_RING, f.x, f.y, 0, 0, 0.6, 140, 'rgba(255,240,180,0.95)');
          snd?.play('shatter');
          break;
        case 'roar': case 'spears': case 'spit':
          snd?.play('roar');
          break;
        case 'vent':
          this.pop(f.x, f.y + 50, 'WEAK SPOT!', '#ffb21e', 22);
          break;
        case 'eat':
          this.pop(f.x, f.y - 30, '+HP', TONE_TEXT.bad, 20);
          break;
        case 'nova':
          P.add(P_RING, f.x, f.y, 0, 0, 0.7, 500, 'rgba(170,235,255,0.9)');
          snd?.play('nova');
          break;
        case 'overclock':
          this.pop(f.x, f.y + 60, 'OVERCLOCK', '#ffe45c', 24);
          snd?.play('nova');
          break;
        case 'ability':
          if (f.s === 'grenade') snd?.play('throw');
          break;
        case 'win': snd?.play('win'); break;
        case 'lose': snd?.play('lose'); break;
      }
    }
    sim.fx.length = 0;
  }

  private pop(x: number, y: number, text: string, color: string, size: number): void {
    if (!text) return;
    if (this.pops.length > 30) this.pops.shift();
    this.pops.push({ x, y, text, color, size, t: 0, dur: 1.0 });
  }

  /* ------------------------------------------------------------------ */
  /* Frame                                                               */
  /* ------------------------------------------------------------------ */

  draw(sim: Sim, dt: number): void {
    const g = this.ctx;
    this.realT += dt;
    this.parts.update(dt);
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 30);
      this.ox = (Math.random() - 0.5) * this.shake;
      this.oy = (Math.random() - 0.5) * this.shake;
    } else this.ox = this.oy = 0;

    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const cam = sim.squadY;
    this.drawGround(sim, cam);
    this.drawWalls(sim, cam);
    this.drawHazards(sim, cam);
    this.drawGates(sim, cam, false);
    this.drawPrizes(sim, cam);
    this.drawBarricades(sim, cam);
    this.drawUnits(sim, cam);
    this.drawGates(sim, cam, true);
    this.drawBullets(sim, cam);
    this.drawMissiles(sim, cam);
    this.drawParticles(cam);
    this.drawPops(cam, dt);
    this.drawHud(sim, dt);
  }

  private drawGround(sim: Sim, cam: number): void {
    const g = this.ctx;
    const s = this.scale;
    g.fillStyle = '#5fbf57';
    g.fillRect(0, 0, this.w, this.h);
    // grass stripes
    const top = cam + this.squadSY / s, bot = cam - (this.h - this.squadSY) / s;
    const band = 90;
    g.fillStyle = '#56b14f';
    for (let y = Math.floor(bot / band) * band; y < top; y += band * 2) {
      const y0 = this.sy(y + band, cam), y1 = this.sy(y, cam);
      g.fillRect(0, y0, this.w, y1 - y0);
    }
    // track
    const x0 = this.sx(-TRACK_HALF), x1 = this.sx(TRACK_HALF);
    g.fillStyle = '#e8dcc0';
    g.fillRect(x0, 0, x1 - x0, this.h);
    g.fillStyle = '#e1d3b3';
    for (let y = Math.floor(bot / band) * band; y < top; y += band * 2) {
      const y0 = this.sy(y + band, cam), y1 = this.sy(y, cam);
      g.fillRect(x0, y0, x1 - x0, y1 - y0);
    }
    // curbs
    const cw = 5 * s;
    for (let y = Math.floor(bot / 30) * 30; y < top; y += 30) {
      g.fillStyle = Math.floor(y / 30) % 2 === 0 ? '#ffffff' : '#ff5a5f';
      const ya = this.sy(y + 30, cam), yb = this.sy(y, cam);
      g.fillRect(x0 - cw, ya, cw, yb - ya);
      g.fillRect(x1, ya, cw, yb - ya);
    }
    // lane dashes
    g.fillStyle = 'rgba(255,255,255,0.55)';
    for (const lx of [-TRACK_HALF / 3, TRACK_HALF / 3]) {
      const x = this.sx(lx);
      for (let y = Math.floor(bot / 60) * 60; y < top; y += 60) {
        const ya = this.sy(y + 30, cam), yb = this.sy(y, cam);
        g.fillRect(x - 1.5, ya, 3, yb - ya);
      }
    }
    // finish line
    if (!sim.level.boss) {
      const fy = this.sy(sim.level.length, cam);
      if (fy > -30 && fy < this.h + 30) {
        const n = 16, cell = (x1 - x0) / n;
        for (let r = 0; r < 2; r++) for (let k = 0; k < n; k++) {
          g.fillStyle = (k + r) % 2 ? '#1c2233' : '#ffffff';
          g.fillRect(x0 + k * cell, fy - (r + 1) * cell * 0.6, cell, cell * 0.6);
        }
      }
    }
  }

  private drawWalls(sim: Sim, cam: number): void {
    const g = this.ctx;
    const s = this.scale;
    for (const w of sim.walls) {
      const ya = this.sy(w.y + w.h, cam), yb = this.sy(w.y, cam);
      if (yb < -40 || ya > this.h + 40) continue;
      const xa = this.sx(w.x0), xb = this.sx(w.x1);
      const lift = 12 * s;
      g.fillStyle = '#6f7787';
      g.fillRect(xa, ya - lift, xb - xa, yb - ya + lift);
      g.fillStyle = '#9aa3b5';
      g.fillRect(xa, ya - lift, xb - xa, yb - ya);
      // hazard stripe on the front face
      g.save();
      g.beginPath();
      g.rect(xa, yb - lift, xb - xa, lift);
      g.clip();
      g.fillStyle = '#ffcf33';
      g.fillRect(xa, yb - lift, xb - xa, lift);
      g.fillStyle = '#2b2f3a';
      for (let x = xa - lift; x < xb; x += lift * 1.4) {
        g.beginPath();
        g.moveTo(x, yb); g.lineTo(x + lift * 0.7, yb - lift); g.lineTo(x + lift * 1.1, yb - lift); g.lineTo(x + lift * 0.4, yb);
        g.fill();
      }
      g.restore();
    }
  }

  private drawHazards(sim: Sim, cam: number): void {
    const g = this.ctx;
    for (const h of sim.hazards) {
      const p = Math.min(1, h.t / h.dur);
      const pulse = 0.5 + 0.5 * Math.sin(this.realT * 20);
      if (h.kind === 'rect') {
        const xa = this.sx(h.x0), xb = this.sx(h.x1);
        const ya = this.sy(h.y1, cam), yb = this.sy(h.y0, cam);
        g.fillStyle = `rgba(255,40,50,${0.12 + 0.12 * pulse})`;
        g.fillRect(xa, ya, xb - xa, yb - ya);
        g.fillStyle = 'rgba(255,40,50,0.35)';
        g.fillRect(xa, yb - (yb - ya) * p, xb - xa, (yb - ya) * p);
        g.strokeStyle = 'rgba(255,255,255,0.8)';
        g.setLineDash([8, 6]);
        g.lineWidth = 2;
        g.strokeRect(xa, ya, xb - xa, yb - ya);
        g.setLineDash([]);
        g.fillStyle = '#fff';
        g.font = `700 ${22}px ${FONT}`;
        g.textAlign = 'center';
        g.fillText('!', (xa + xb) / 2, yb - 16);
      } else {
        const x = this.sx(h.cx), y = this.sy(h.cy, cam);
        g.strokeStyle = `rgba(255,60,120,${0.5 + 0.4 * pulse})`;
        g.lineWidth = 2.5;
        g.beginPath();
        g.ellipse(x, y, h.r * this.scale, h.r * this.scale * 0.6, 0, 0, Math.PI * 2);
        g.stroke();
        g.fillStyle = 'rgba(255,60,120,0.25)';
        g.beginPath();
        g.ellipse(x, y, h.r * this.scale * p, h.r * this.scale * 0.6 * p, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  /** Gates are drawn in two passes: posts and panel back first, labels on top of the crowd. */
  private drawGates(sim: Sim, cam: number, labels: boolean): void {
    const g = this.ctx;
    const s = this.scale;
    for (const gt of sim.gates) {
      if (gt.gone && !gt.used) continue;
      if (gt.used) continue;
      const y = this.sy(gt.y, cam);
      if (y < -80 || y > this.h + 60) continue;
      const xa = this.sx(gt.x - gt.w / 2), xb = this.sx(gt.x + gt.w / 2);
      const ph = 50 * s;
      const tone = gt.tone;
      const fade = gt.passed ? 0.35 : 1;
      g.globalAlpha = fade;
      if (!labels) {
        g.fillStyle = gt.flash > 0 ? 'rgba(255,255,255,0.75)' : TONE_FILL[tone];
        g.beginPath();
        g.roundRect(xa, y - ph, xb - xa, ph, 6 * s);
        g.fill();
        g.strokeStyle = TONE_EDGE[tone];
        g.lineWidth = 3 * s;
        g.stroke();
        // posts
        g.fillStyle = TONE_POST[tone];
        const pw = 6 * s;
        g.beginPath(); g.roundRect(xa - pw / 2, y - ph - 6 * s, pw, ph + 8 * s, pw / 2); g.fill();
        g.beginPath(); g.roundRect(xb - pw / 2, y - ph - 6 * s, pw, ph + 8 * s, pw / 2); g.fill();
        if (gt.alt && !gt.passed) {
          // flip timer: draining bar plus seconds left, and a hint of what it turns into
          const left = gt.period - (sim.time % gt.period);
          const k = left / gt.period;
          g.fillStyle = 'rgba(255,255,255,0.9)';
          g.fillRect(xa + 6 * s, y - 6 * s, (xb - xa - 12 * s) * k, 4 * s);
          const next = gt.flipped ? gt.mods : gt.alt;
          g.font = `700 ${11 * s}px ${FONT}`;
          g.textAlign = 'center';
          g.fillStyle = left < 0.8 ? '#ffe45c' : '#ffffff';
          g.fillText(`${Math.ceil(left)}s → ${modLabel(next[0])}`, (xa + xb) / 2, y - ph - 10 * s);
        }
      } else {
        const mods = sim.gateMods(gt);
        const cx = (xa + xb) / 2;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        const big = mods[0];
        const bigText = modLabel(big);
        const isNum = big.k === 'add' || big.k === 'mul' || big.k === 'div';
        const fs = (isNum ? 30 : 15) * s;
        g.font = `700 ${fs}px ${FONT}`;
        g.lineWidth = 4 * s;
        g.strokeStyle = 'rgba(0,0,0,0.35)';
        const lines = mods.length;
        let ty = y - ph / 2 - (lines - 1) * 8 * s;
        g.strokeText(bigText, cx, ty);
        g.fillStyle = '#ffffff';
        g.fillText(bigText, cx, ty);
        g.font = `700 ${13 * s}px ${FONT}`;
        for (let k = 1; k < lines; k++) {
          ty += (k === 1 ? fs * 0.6 + 6 * s : 15 * s);
          const t = modLabel(mods[k]);
          g.strokeText(t, cx, ty);
          g.fillText(t, cx, ty);
        }
        if (gt.shoot > 0 && !gt.passed) {
          const absorbing = sim.gateAbsorbs(gt);
          const bw = (xb - xa) * 0.6;
          const by = y - 9 * s;
          g.fillStyle = 'rgba(0,0,0,0.3)';
          g.fillRect(cx - bw / 2, by, bw, 4 * s);
          g.fillStyle = '#ffffff';
          g.fillRect(cx - bw / 2, by, bw * (absorbing ? gt.progress / gt.shoot : 1), 4 * s);
          if (!absorbing) {
            g.font = `700 ${10 * s}px ${FONT}`;
            g.fillText('MAX', cx, by - 7 * s);
          } else {
            g.font = `700 ${10 * s}px ${FONT}`;
            g.fillStyle = 'rgba(255,255,255,0.9)';
            g.fillText('SHOOT ▲', cx, y - ph - 10 * s);
          }
        }
        g.textBaseline = 'alphabetic';
      }
      g.globalAlpha = 1;
    }
  }

  private crackSet(p: Prize): number[][] {
    let c = this.cracks.get(p);
    if (!c) {
      c = [];
      let seed = Math.floor(p.x * 13 + p.y * 7) >>> 0;
      const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
      for (let k = 0; k < 9; k++) {
        const pts: number[] = [];
        let x = (rnd() - 0.5) * 0.6, y = (rnd() - 0.5) * 0.6;
        pts.push(x, y);
        for (let j = 0; j < 4; j++) {
          x += (rnd() - 0.5) * 0.5; y += (rnd() - 0.5) * 0.5;
          pts.push(Math.max(-0.5, Math.min(0.5, x)), Math.max(-0.5, Math.min(0.5, y)));
        }
        c.push(pts);
      }
      this.cracks.set(p, c);
    }
    return c;
  }

  private drawPrizes(sim: Sim, cam: number): void {
    const g = this.ctx;
    const s = this.scale;
    for (const p of sim.prizes) {
      if (p.state === 'broken') continue;
      const yb = this.sy(p.y - p.h / 2, cam), ya = this.sy(p.y + p.h / 2, cam);
      if (yb < -80 || ya > this.h + 80) continue;
      const xa = this.sx(p.x - p.w / 2), xb = this.sx(p.x + p.w / 2);
      const lift = 26 * s;
      const top = ya - lift;
      const W = xb - xa, H = yb - top;
      g.globalAlpha = p.state === 'lost' ? 0.45 : 1;
      // shadow
      g.fillStyle = 'rgba(20,40,80,0.2)';
      g.beginPath(); g.ellipse((xa + xb) / 2, yb, W * 0.62, 9 * s, 0, 0, Math.PI * 2); g.fill();
      // contents
      this.drawReward(p.reward, (xa + xb) / 2, yb - H * 0.18, H * 0.62);
      // ice
      const grd = g.createLinearGradient(xa, top, xb, yb);
      grd.addColorStop(0, p.flash > 0 ? 'rgba(255,255,255,0.85)' : 'rgba(205,245,255,0.72)');
      grd.addColorStop(1, 'rgba(120,200,240,0.62)');
      g.fillStyle = grd;
      g.beginPath(); g.roundRect(xa, top, W, H, 8 * s); g.fill();
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 2.5 * s;
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.55)';
      g.beginPath(); g.roundRect(xa + 6 * s, top + 6 * s, W * 0.18, H * 0.55, 4 * s); g.fill();
      // cracks
      const frac = 1 - p.hp / p.maxHp;
      const cr = this.crackSet(p);
      const shown = Math.floor(frac * cr.length + 0.001);
      g.strokeStyle = 'rgba(255,255,255,0.95)';
      g.lineWidth = 1.6 * s;
      for (let k = 0; k < shown; k++) {
        const pts = cr[k];
        g.beginPath();
        for (let j = 0; j < pts.length; j += 2) {
          const x = (xa + xb) / 2 + pts[j] * W, y = (top + yb) / 2 + pts[j + 1] * H;
          if (j === 0) g.moveTo(x, y); else g.lineTo(x, y);
        }
        g.stroke();
      }
      // HP
      if (p.state === 'frozen') {
        g.textAlign = 'center';
        g.font = `700 ${20 * s}px ${FONT}`;
        g.lineWidth = 4 * s;
        g.strokeStyle = '#1c5a8a';
        const t = String(Math.ceil(p.hp));
        g.strokeText(t, (xa + xb) / 2, top - 8 * s);
        g.fillStyle = '#ffffff';
        g.fillText(t, (xa + xb) / 2, top - 8 * s);
      }
      g.globalAlpha = 1;
    }
  }

  private drawReward(reward: string, cx: number, cy: number, size: number): void {
    const g = this.ctx;
    const [kind, arg] = reward.split(':');
    if (kind === 'mech') this.drawMechShape(cx, cy + size * 0.45, size * 0.5, 0, 0);
    else if (kind === 'weapon') {
      g.save();
      g.translate(cx, cy);
      g.rotate(-0.5);
      g.fillStyle = '#2a2f3a';
      g.beginPath(); g.roundRect(-size * 0.4, -size * 0.08, size * 0.8, size * 0.16, 3); g.fill();
      g.fillStyle = arg === 'launcher' ? '#ff9a3c' : arg === 'frost' ? '#8fe4ff' : arg === 'spread' ? '#ffd36b' : '#c6f6ff';
      g.beginPath(); g.roundRect(-size * 0.2, -size * 0.14, size * 0.32, size * 0.28, 3); g.fill();
      g.restore();
    } else {
      const sp = unitSprite('soldier', 5, 0);
      for (let k = 0; k < 3; k++) this.stamp(sp, cx + (k - 1) * size * 0.25, cy + size * 0.3, size / 22);
    }
  }

  private drawBarricades(sim: Sim, cam: number): void {
    const g = this.ctx;
    const s = this.scale;
    for (const b of sim.barricades) {
      const y = this.sy(sim.barricadeY(b), cam);
      const xa = this.sx(b.x0), xb = this.sx(b.x1);
      g.globalAlpha = Math.min(1, b.t * 2);
      g.fillStyle = '#3d4554';
      g.fillRect(xa, y - 14 * s, xb - xa, 14 * s);
      g.fillStyle = '#ffcf33';
      for (let x = xa; x < xb; x += 18 * s) g.fillRect(x, y - 12 * s, 9 * s, 5 * s);
      g.globalAlpha = 1;
    }
  }

  /** Figures are drawn a bit larger than their collision circles: chunkier and easier to read. */
  private stamp(sp: Sprite, x: number, y: number, k: number): void {
    const s = this.scale * k * 1.25;
    this.ctx.drawImage(sp.c, x - sp.ax * s, y - sp.ay * s, sp.w * s, sp.h * s);
  }

  private drawUnits(sim: Sim, cam: number): void {
    const w = sim.world;
    const order = this.order, oy = this.orderY;
    order.length = 0; oy.length = 0;
    const topY = cam + (this.squadSY + 60) / this.scale;
    const botY = cam - (this.h - this.squadSY + 60) / this.scale;
    for (const i of sim.enemies) {
      if (sim.eDead[i] || w.y[i] > topY || w.y[i] < botY) continue;
      order.push(i); oy.push(w.y[i]);
    }
    for (const i of sim.soldiers) { order.push(i); oy.push(w.y[i]); }
    if (sim.mech) { order.push(-1); oy.push(sim.mech.y); }
    if (sim.boss && !sim.boss.dead) { order.push(-2); oy.push(sim.boss.y); }
    for (const t of sim.throws) { order.push(-3); oy.push(-1e9); void t; }
    const idx = order.map((_, k) => k);
    idx.sort((a, b) => oy[b] - oy[a]);

    const t = this.realT;
    for (const k of idx) {
      const i = order[k];
      if (i === -1) { const m = sim.mech!; this.drawMechShape(this.sx(m.x), this.sy(m.y, cam), 20 * this.scale, m.flash, t); continue; }
      if (i === -2) { this.drawBoss(sim, cam); continue; }
      if (i === -3) continue;
      const x = w.x[i], y = w.y[i];
      if (w.group[i] === 1) {
        const r = w.r[i];
        const frame = Math.floor(t * 9 + i * 0.37) & 1;
        const sp = unitSprite(sim.lo.squad === 'heavies' ? 'heavy' : 'soldier', r, frame);
        this.stamp(sp, this.sx(x), this.sy(y, cam), 1);
      } else {
        const kind = sim.kindOf(i);
        const r = ENEMIES[kind].r;
        const spd = kind === 'runner' ? 16 : kind === 'splitling' ? 13 : 6;
        const frame = Math.floor(t * spd + i * 0.53) & 1;
        const flash = sim.eFlash[i] > 0 && (sim.eMaxHp[i] < 20 || Math.floor(t * 14 + i) % 3 === 0);
        const sp = unitSprite(kind, r, frame, flash);
        const lurch = kind === 'zombie' || kind === 'brute' ? Math.sin(t * 4 + i) * 1.2 : 0;
        const slow = sim.eSlow[i] > 0 || sim.novaT > 0;
        this.stamp(sp, this.sx(x + lurch), this.sy(y, cam), 1);
        if (slow) {
          const g = this.ctx;
          g.fillStyle = 'rgba(160,230,255,0.45)';
          g.beginPath();
          g.ellipse(this.sx(x), this.sy(y, cam) - r * 1.3 * this.scale, r * this.scale, r * 1.4 * this.scale, 0, 0, Math.PI * 2);
          g.fill();
        }
        if (ENEMIES[kind].shield > 0 && sim.eShield[i] <= 0 && kind === 'shielded') {
          // broken shield: little crack mark
          const g = this.ctx;
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1.5;
          g.beginPath();
          g.moveTo(this.sx(x) - 3, this.sy(y, cam) - r * 1.8 * this.scale);
          g.lineTo(this.sx(x) + 3, this.sy(y, cam) - r * 1.2 * this.scale);
          g.stroke();
        }
        if (sim.eMaxHp[i] >= 20) this.hpBar(this.sx(x), this.sy(y, cam) - r * 3.6 * this.scale, r * 2 * this.scale, sim.eHp[i] / sim.eMaxHp[i]);
      }
    }
    // grenades in flight, drawn above everything
    for (const th of sim.throws) {
      const p = th.t / th.dur;
      const y = th.y0 + (th.y - th.y0) * p;
      const arc = Math.sin(p * Math.PI) * 60;
      const g = this.ctx;
      const X = this.sx(th.x), Y = this.sy(y, cam) - arc * this.scale;
      g.fillStyle = '#3b4a2f';
      g.beginPath(); g.arc(X, Y, 5 * this.scale, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffcf33';
      g.fillRect(X - 1.5 * this.scale, Y - 7 * this.scale, 3 * this.scale, 3 * this.scale);
    }
  }

  private hpBar(x: number, y: number, w: number, f: number): void {
    const g = this.ctx;
    g.fillStyle = 'rgba(0,0,0,0.45)';
    g.fillRect(x - w / 2, y, w, 4);
    g.fillStyle = '#ff4b55';
    g.fillRect(x - w / 2, y, w * Math.max(0, f), 4);
  }

  private drawMechShape(x: number, y: number, size: number, flash: number, t: number): void {
    const g = this.ctx;
    const step = Math.sin(t * 8) * size * 0.08;
    const steel = flash > 0 ? '#ffffff' : '#8ea3bf';
    const dark = flash > 0 ? '#ffffff' : '#3e4d66';
    const blue = flash > 0 ? '#ffffff' : '#3d8bff';
    g.fillStyle = 'rgba(20,30,60,0.22)';
    g.beginPath(); g.ellipse(x, y, size * 0.9, size * 0.3, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = dark;
    g.beginPath(); g.roundRect(x - size * 0.55, y - size * 0.7 + step, size * 0.35, size * 0.7, size * 0.1); g.fill();
    g.beginPath(); g.roundRect(x + size * 0.2, y - size * 0.7 - step, size * 0.35, size * 0.7, size * 0.1); g.fill();
    g.fillStyle = steel;
    g.strokeStyle = dark;
    g.lineWidth = Math.max(1.5, size * 0.07);
    g.beginPath(); g.roundRect(x - size * 0.75, y - size * 1.6, size * 1.5, size * 1.0, size * 0.25); g.fill(); g.stroke();
    g.fillStyle = blue;
    g.beginPath(); g.roundRect(x - size * 0.35, y - size * 1.85, size * 0.7, size * 0.4, size * 0.15); g.fill();
    g.fillStyle = dark;
    g.fillRect(x - size * 1.0, y - size * 2.1, size * 0.22, size * 0.9);
    g.fillRect(x + size * 0.78, y - size * 2.1, size * 0.22, size * 0.9);
  }

  private drawBoss(sim: Sim, cam: number): void {
    const b = sim.boss!;
    const g = this.ctx;
    const s = this.scale;
    const x = this.sx(b.x), y = this.sy(b.y, cam);
    const R = b.r * s;
    const t = this.realT;
    // Under constant fire the flash flickers instead of turning the boss solid white.
    const white = b.flash > 0 && Math.floor(this.realT * 20) % 5 === 0;
    const bob = Math.sin(t * 3) * 2;
    g.fillStyle = 'rgba(20,30,60,0.25)';
    g.beginPath(); g.ellipse(x, y, R * 1.2, R * 0.4, 0, 0, Math.PI * 2); g.fill();
    let body = '#b3262d', dark = '#5a1013';
    if (b.kind === 'ironHulk') { body = '#7f8a9c'; dark = '#3a4352'; }
    if (b.kind === 'broodMother') { body = '#c9356f'; dark = '#5f1031'; }
    if (b.kind === 'warden') { body = '#c7343b'; dark = '#5d1418'; }
    if (b.kind === 'gateEater') { body = '#8e1d48'; dark = '#3f0a1f'; }
    if (white) { body = '#ffffff'; dark = '#ffffff'; }
    const charge = b.state === 'charge' ? 1 : 0;
    // legs
    g.fillStyle = dark;
    g.beginPath(); g.roundRect(x - R * 0.7, y - R * 0.9 + bob, R * 0.5, R * 0.9, R * 0.2); g.fill();
    g.beginPath(); g.roundRect(x + R * 0.2, y - R * 0.9 - bob, R * 0.5, R * 0.9, R * 0.2); g.fill();
    // body
    g.fillStyle = body;
    g.strokeStyle = dark;
    g.lineWidth = R * 0.1;
    g.beginPath(); g.ellipse(x, y - R * 1.5, R * (b.kind === 'broodMother' ? 1.35 : 1.1), R * 0.95, 0, 0, Math.PI * 2); g.fill(); g.stroke();
    // head
    g.beginPath(); g.arc(x, y - R * 2.6 - charge * R * 0.2, R * 0.6, 0, Math.PI * 2); g.fill(); g.stroke();
    // arms
    g.lineWidth = R * 0.38;
    g.strokeStyle = body;
    g.beginPath();
    g.moveTo(x - R * 0.95, y - R * 1.8); g.lineTo(x - R * 1.35, y - R * 0.9 - charge * R * 0.4);
    g.moveTo(x + R * 0.95, y - R * 1.8); g.lineTo(x + R * 1.35, y - R * 0.9 - charge * R * 0.4);
    g.stroke();
    const hx = x, hy = y - R * 2.6;
    switch (b.kind) {
      case 'bruteKing':
        if (!white) {
          g.fillStyle = '#ffcf33';
          g.beginPath();
          g.moveTo(hx - R * 0.5, hy - R * 0.35);
          for (let k = 0; k <= 4; k++) g.lineTo(hx - R * 0.5 + k * R * 0.25, hy - R * (k % 2 ? 0.6 : 0.95));
          g.lineTo(hx + R * 0.5, hy - R * 0.35);
          g.closePath(); g.fill();
        }
        break;
      case 'ironHulk':
        g.fillStyle = b.vent ? `rgba(255,${150 + 80 * Math.sin(t * 18)},40,1)` : '#4b5566';
        g.beginPath(); g.arc(x, y - R * 1.5, R * 0.38, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#a7b2c4';
        g.fillRect(x - R * 1.0, y - R * 2.2, R * 2.0, R * 0.22);
        break;
      case 'broodMother':
        if (!white) {
          g.fillStyle = '#f7c4dc';
          for (const [ex, ey] of [[-0.8, -1.2], [0.7, -1.0], [-0.3, -0.9], [0.4, -1.8], [-0.7, -1.8]]) {
            g.beginPath(); g.ellipse(x + ex * R, y + ey * R, R * 0.2, R * 0.26, 0, 0, Math.PI * 2); g.fill();
          }
        }
        break;
      case 'warden':
        if (b.shieldUp) {
          g.fillStyle = white ? '#fff' : '#6f8fb3';
          g.strokeStyle = '#2c425c';
          g.lineWidth = R * 0.08;
          g.beginPath(); g.roundRect(x - R * 1.3, y - R * 2.2, R * 2.6, R * 1.6, R * 0.3); g.fill(); g.stroke();
          g.fillStyle = '#b6cbe3';
          g.fillRect(x - R * 1.05, y - R * 2.0, R * 0.25, R * 1.2);
        } else {
          g.fillStyle = '#ffcf33';
          g.font = `700 ${14 * s}px ${FONT}`;
          g.textAlign = 'center';
          g.fillText('OPEN!', x, y - R * 3.5);
        }
        break;
      case 'gateEater':
        g.fillStyle = '#2a0612';
        g.beginPath(); g.ellipse(x, y - R * 1.45, R * 0.75, R * (b.state === 'inhale' ? 0.6 : 0.35), 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffffff';
        for (let k = -3; k <= 3; k++) {
          g.beginPath();
          g.moveTo(x + k * R * 0.2 - R * 0.08, y - R * 1.75);
          g.lineTo(x + k * R * 0.2 + R * 0.08, y - R * 1.75);
          g.lineTo(x + k * R * 0.2, y - R * 1.55);
          g.fill();
        }
        break;
    }
  }

  private drawBullets(sim: Sim, cam: number): void {
    const g = this.ctx;
    const s = this.scale;
    for (let look = 0; look < 6; look++) {
      if (look === 3) continue;
      g.strokeStyle = BULLET_COLOR[look];
      g.lineWidth = BULLET_WIDTH[look] * s;
      g.lineCap = 'round';
      g.beginPath();
      let any = false;
      const tail = BULLET_TAIL[look];
      for (let b = 0; b < sim.nb; b++) {
        if (sim.blook[b] !== look) continue;
        const x = sim.bx[b], y = sim.by[b];
        g.moveTo(this.sx(x), this.sy(y, cam));
        g.lineTo(this.sx(x - sim.bvx[b] * tail), this.sy(y - sim.bvy[b] * tail, cam));
        any = true;
      }
      if (any) g.stroke();
    }
    // launcher shells
    g.fillStyle = BULLET_COLOR[3];
    g.beginPath();
    for (let b = 0; b < sim.nb; b++) {
      if (sim.blook[b] !== 3) continue;
      const X = this.sx(sim.bx[b]), Y = this.sy(sim.by[b], cam);
      g.moveTo(X + 3.5 * s, Y);
      g.arc(X, Y, 3.5 * s, 0, Math.PI * 2);
    }
    g.fill();
  }

  private drawMissiles(sim: Sim, cam: number): void {
    const g = this.ctx;
    const s = this.scale;
    for (const m of sim.missiles) {
      const X = this.sx(m.x), Y = this.sy(m.y, cam);
      if (m.kind === 'egg') {
        const toLand = Math.max(0, m.y - m.landY);
        const arc = Math.min(70, toLand * 0.25);
        g.fillStyle = 'rgba(20,30,60,0.2)';
        g.beginPath(); g.ellipse(X, Y, m.r * s, m.r * 0.4 * s, 0, 0, Math.PI * 2); g.fill();
        g.fillStyle = '#ffe3ef';
        g.strokeStyle = '#c9356f';
        g.lineWidth = 2;
        g.beginPath(); g.ellipse(X, Y - arc * s, m.r * s, m.r * 1.25 * s, 0, 0, Math.PI * 2); g.fill(); g.stroke();
      } else {
        g.strokeStyle = '#4b5566';
        g.lineWidth = 3 * s;
        g.beginPath(); g.moveTo(X, Y - 26 * s); g.lineTo(X, Y + 4 * s); g.stroke();
        g.fillStyle = '#d6dde8';
        g.beginPath(); g.moveTo(X - 5 * s, Y); g.lineTo(X + 5 * s, Y); g.lineTo(X, Y + 12 * s); g.fill();
      }
    }
  }

  private drawParticles(cam: number): void {
    const g = this.ctx;
    const P = this.parts;
    const s = this.scale;
    for (let i = 0; i < P.n; i++) {
      const a = P.life[i] / P.max[i];
      const X = this.sx(P.x[i]), Y = this.sy(P.y[i], cam);
      const k = P.kind[i];
      g.globalAlpha = k === P_RING ? a : Math.min(1, a * 1.5);
      if (k === P_RING) {
        g.strokeStyle = P.color[i];
        g.lineWidth = 3 * s * a + 1;
        g.beginPath();
        g.ellipse(X, Y, P.size[i] * (1 - a) * s + 2, P.size[i] * (1 - a) * s * 0.7 + 1, 0, 0, Math.PI * 2);
        g.stroke();
      } else if (k === P_SHARD) {
        g.fillStyle = P.color[i];
        const z = P.size[i] * s;
        g.beginPath(); g.moveTo(X, Y - z); g.lineTo(X + z * 0.6, Y + z * 0.5); g.lineTo(X - z * 0.6, Y + z * 0.4); g.fill();
      } else if (k === P_SMOKE) {
        g.fillStyle = P.color[i];
        g.beginPath(); g.arc(X, Y, P.size[i] * s * (1.6 - a), 0, Math.PI * 2); g.fill();
      } else {
        g.fillStyle = P.color[i];
        const z = P.size[i] * s;
        g.fillRect(X - z / 2, Y - z / 2, z, z);
      }
    }
    g.globalAlpha = 1;
  }

  private drawPops(cam: number, dt: number): void {
    const g = this.ctx;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    for (const p of this.pops) p.t += dt;
    this.pops = this.pops.filter((p) => p.t < p.dur);
    for (const p of this.pops) {
      const k = p.t / p.dur;
      const bounce = k < 0.15 ? 0.6 + (k / 0.15) * 0.6 : 1.2 - Math.min(0.2, (k - 0.15) * 0.8);
      const X = this.sx(p.x), Y = this.sy(p.y, cam) - k * 40;
      g.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
      g.font = `700 ${p.size * bounce * Math.max(0.8, this.scale)}px ${FONT}`;
      g.lineWidth = 5;
      g.strokeStyle = 'rgba(10,20,50,0.6)';
      g.strokeText(p.text, X, Y);
      g.fillStyle = p.color;
      g.fillText(p.text, X, Y);
    }
    g.globalAlpha = 1;
    g.textBaseline = 'alphabetic';
  }

  /* ------------------------------------------------------------------ */
  /* HUD                                                                 */
  /* ------------------------------------------------------------------ */

  private drawHud(sim: Sim, dt: number): void {
    const g = this.ctx;
    const s = this.scale;
    const cam = sim.squadY;
    // squad count bubble
    if (sim.count > 0) {
      const X = this.sx(sim.leaderX);
      const Y = this.sy(cam + sim.formationR * 0.72 + 4, cam) - 30 * s;
      const text = String(sim.count);
      g.font = `700 ${18 * Math.max(1, s)}px ${FONT}`;
      const tw = g.measureText(text).width + 18;
      g.fillStyle = '#1f5fd1';
      g.beginPath(); g.roundRect(X - tw / 2, Y - 14, tw, 26, 13); g.fill();
      g.strokeStyle = '#ffffff';
      g.lineWidth = 2.5;
      g.stroke();
      g.beginPath(); g.moveTo(X - 6, Y + 12); g.lineTo(X + 6, Y + 12); g.lineTo(X, Y + 19); g.fillStyle = '#1f5fd1'; g.fill();
      g.fillStyle = '#ffffff';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text, X, Y);
      g.textBaseline = 'alphabetic';
    }

    // top bar
    const safeTop = 12;
    const bw = Math.min(this.w * 0.56, 300);
    const bx = this.w / 2 - bw / 2, by = safeTop + 8;
    const b = sim.boss;
    g.fillStyle = 'rgba(15,25,55,0.45)';
    g.beginPath(); g.roundRect(bx, by, bw, 12, 6); g.fill();
    if (b) {
      g.fillStyle = b.vent ? '#ffb21e' : '#ff4b55';
      g.beginPath(); g.roundRect(bx, by, bw * Math.max(0, b.hp / b.maxHp), 12, 6); g.fill();
      g.font = `700 13px ${FONT}`;
      g.textAlign = 'center';
      g.fillStyle = '#ffffff';
      g.fillText(b.name.toUpperCase(), this.w / 2, by + 30);
    } else {
      g.fillStyle = '#ffffff';
      g.beginPath(); g.roundRect(bx, by, Math.max(12, bw * sim.progress), 12, 6); g.fill();
      for (const p of sim.prizes) {
        const px = bx + bw * Math.min(1, p.y / sim.level.length);
        g.fillStyle = p.state === 'broken' ? '#4aa3ff' : p.state === 'lost' ? '#8a93a6' : '#bdf0ff';
        g.beginPath(); g.arc(px, by + 6, 5, 0, Math.PI * 2); g.fill();
      }
    }
    // weapon and stat chips
    const chips: string[] = [WEAPONS[sim.weapon].name];
    if (Math.abs(sim.fireMult - 1) > 0.01) chips.push(`FIRE x${sim.fireMult.toFixed(2).replace(/0$/, '')}`);
    if (Math.abs(sim.dmgMult - 1) > 0.01) chips.push(`DMG x${sim.dmgMult.toFixed(2).replace(/0$/, '')}`);
    if (sim.pierceAdd > 0) chips.push(`PIERCE +${sim.pierceAdd}`);
    if (sim.mech) chips.push(`MECH ${sim.mech.hp}`);
    g.font = `600 11px ${FONT}`;
    let cx = 10;
    const cy = by + (b ? 40 : 24);
    g.textAlign = 'left';
    for (const c of chips) {
      const tw = g.measureText(c).width + 12;
      g.fillStyle = 'rgba(15,25,55,0.45)';
      g.beginPath(); g.roundRect(cx, cy, tw, 18, 9); g.fill();
      g.fillStyle = '#ffffff';
      g.fillText(c, cx + 6, cy + 13);
      cx += tw + 5;
    }

    // hint and banners
    const hint = sim.level.hint;
    if (hint && sim.time < 5) {
      const a = Math.min(1, (5 - sim.time) * 1.5);
      this.card(hint, '', this.h * 0.42, a);
    }
    if (this.banner) {
      this.banner.t += dt;
      const a = this.banner.t < 2.2 ? Math.min(1, this.banner.t * 4) : Math.max(0, 1 - (this.banner.t - 2.2) * 3);
      this.card(this.banner.text, this.banner.sub, this.h * 0.35, a, 30);
      if (this.banner.t > 2.6) this.banner = null;
    }
  }

  private card(text: string, sub: string, y: number, a: number, size = 17): void {
    const g = this.ctx;
    g.globalAlpha = a;
    g.font = `700 ${size}px ${FONT}`;
    g.textAlign = 'center';
    const maxW = Math.min(this.w - 40, 340);
    const lines = wrap(g, text, maxW - 24);
    const lh = size * 1.25;
    const hgt = lines.length * lh + (sub ? 22 : 0) + 18;
    g.fillStyle = 'rgba(15,25,60,0.7)';
    g.beginPath(); g.roundRect(this.w / 2 - maxW / 2, y - hgt / 2, maxW, hgt, 14); g.fill();
    g.fillStyle = '#ffffff';
    lines.forEach((l, k) => g.fillText(l, this.w / 2, y - hgt / 2 + 9 + lh * (k + 0.8)));
    if (sub) {
      g.font = `600 13px ${FONT}`;
      g.fillStyle = '#bcd3ff';
      g.fillText(sub, this.w / 2, y + hgt / 2 - 12);
    }
    g.globalAlpha = 1;
  }
}

function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const words = text.split(' ');
  const out: string[] = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (g.measureText(t).width > maxW && line) { out.push(line); line = w; }
    else line = t;
  }
  if (line) out.push(line);
  return out;
}

export { LOOKS };
