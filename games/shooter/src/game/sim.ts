import { World, SpatialHash, Rng, dmath, segment, box } from '@engine/index';
import {
  DT, TRACK_HALF, SPAWN_AHEAD, DESPAWN_BEHIND, MAX_SQUAD, SLOT_SPACING, LEADER_SPEED, BOSS_AHEAD,
  L_SQUAD, L_ENEMY, L_WALL,
} from './config';
import type { EnemyKind, LevelData, Loadout, Outcome, Perks, WallData, WaveData, WeaponId, Formation } from './types';
import { ENEMIES } from './enemies';
import { WEAPONS, PELLET_DIRS, armored } from './weapons';
import { parseMods, toneOf, modLabel, type Mod, type Tone } from './gates';
import { runStats, ABILITIES, type RunStats } from './loadout';
import { createBoss, type BossLike } from './bosses';

/* ------------------------------------------------------------------ */
/* Runtime objects                                                     */
/* ------------------------------------------------------------------ */

export interface Gate {
  id: number;
  row: number;
  x: number;
  baseX: number;
  y: number;
  w: number;
  mods: Mod[];
  alt: Mod[] | null;
  period: number;
  /** Showing `alt` right now (flip gates). */
  flipped: boolean;
  shoot: number;
  max: number;
  progress: number;
  move: [number, number] | null;
  /** Drift speed (boss arenas). */
  vy: number;
  used: boolean;
  gone: boolean;
  passed: boolean;
  tone: Tone;
  flash: number;
  /** Turned bad by a thief. */
  stolen: boolean;
}

export interface Prize {
  x: number; y: number; w: number; h: number;
  hp: number; maxHp: number;
  reward: string;
  state: 'frozen' | 'broken' | 'lost';
  flash: number;
}

export interface Mech { x: number; y: number; hp: number; maxHp: number; fireT: number; barrel: number; flash: number }

export interface Hazard {
  kind: 'rect' | 'circle';
  x0: number; x1: number; y0: number; y1: number;
  cx: number; cy: number; r: number;
  t: number; dur: number;
  /** Rect hazards follow the squad in y (boss attacks aimed at the squad line). */
  fire: (s: Sim) => void;
  done: boolean;
}

export interface Missile {
  kind: 'egg' | 'spear' | 'rock';
  x: number; y: number; vx: number; vy: number; r: number;
  /** 0 = can't be shot down. */
  hp: number;
  /** Soldiers it can take down on contact. */
  kill: number;
  /** For eggs: lands when y reaches this. */
  landY: number;
  dead: boolean;
}

export interface Throw { x: number; y: number; y0: number; t: number; dur: number }
export interface Barricade { col: number; x0: number; x1: number; ahead: number; t: number }

/** Visual/audio events. The sim only reports; the renderer decides what they look like. */
export interface Fx { t: string; x: number; y: number; v?: number; s?: string; k?: string }

const KINDS: EnemyKind[] = ['zombie', 'runner', 'armored', 'splitter', 'splitling', 'shielded', 'thief', 'brute'];
const KIND_IDX = Object.fromEntries(KINDS.map((k, i) => [k, i])) as Record<EnemyKind, number>;

const CAP = 2400;
const BCAP = 5000;
const PIERCE_SLOTS = 6;

/** Formation slots (sunflower packing, slightly flattened). */
const SLOT_X = new Float64Array(MAX_SQUAD);
const SLOT_Y = new Float64Array(MAX_SQUAD);
for (let k = 0; k < MAX_SQUAD; k++) {
  const r = SLOT_SPACING * dmath.sqrt(k + 0.35);
  const a = k * 2.399963229728653;
  SLOT_X[k] = dmath.cos(a) * r;
  SLOT_Y[k] = dmath.sin(a) * r * 0.72;
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

/** First t in [0,1] where segment p + t*d enters the circle, or -1. */
export function segCircle(x: number, y: number, dx: number, dy: number, cx: number, cy: number, r: number): number {
  const fx = x - cx, fy = y - cy;
  const c = fx * fx + fy * fy - r * r;
  if (c <= 0) return 0;
  const a = dx * dx + dy * dy;
  if (a === 0) return -1;
  const b = fx * dx + fy * dy;
  if (b > 0) return -1;
  const disc = b * b - a * c;
  if (disc < 0) return -1;
  const t = (-b - dmath.sqrt(disc)) / a;
  return t <= 1 ? t : -1;
}

/** First t in [0,1] where segment p + t*d enters the rect, or -1. */
export function segRect(x: number, y: number, dx: number, dy: number, x0: number, y0: number, x1: number, y1: number): number {
  let t0 = 0, t1 = 1;
  if (dx === 0) { if (x < x0 || x > x1) return -1; }
  else {
    let a = (x0 - x) / dx, b = (x1 - x) / dx;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  if (dy === 0) { if (y < y0 || y > y1) return -1; }
  else {
    let a = (y0 - y) / dy, b = (y1 - y) / dy;
    if (a > b) { const s = a; a = b; b = s; }
    if (a > t0) t0 = a;
    if (b < t1) t1 = b;
    if (t0 > t1) return -1;
  }
  return t0;
}

/* ------------------------------------------------------------------ */
/* Sim                                                                 */
/* ------------------------------------------------------------------ */

export class Sim {
  readonly level: LevelData;
  readonly lo: Loadout;
  readonly stats: RunStats;
  readonly world: World;
  readonly rng: Rng;
  private hash = new SpatialHash(32, 12);

  time = 0;
  squadY = 0;
  leaderX = 0;
  targetX = 0;
  /** Current forward speed (0 once a boss arena locks). */
  scrollNow: number;
  locked = false;
  result: Outcome | null = null;
  /** Set when the run ends, for the results screen. */
  stars = 0;
  starFlags: [boolean, boolean, boolean] = [false, false, false];

  weapon: WeaponId;
  fireMult = 1;
  dmgMult = 1;
  pierceAdd = 0;

  soldiers: number[] = [];
  readonly sHp = new Float64Array(CAP);
  readonly sFire = new Float64Array(CAP);
  private sDead = new Uint8Array(CAP);

  enemies: number[] = [];
  readonly eKind = new Uint8Array(CAP);
  readonly eHp = new Float64Array(CAP);
  readonly eMaxHp = new Float64Array(CAP);
  readonly eShield = new Float64Array(CAP);
  readonly eBites = new Float64Array(CAP);
  readonly eSlow = new Float64Array(CAP);
  readonly eFlash = new Float64Array(CAP);
  readonly eImmune = new Float64Array(CAP);
  readonly eLaneX = new Float64Array(CAP);
  readonly eBiteCd = new Float64Array(CAP);
  readonly eDead = new Uint8Array(CAP);
  readonly eTarget = new Int32Array(CAP);
  private stamp = new Int32Array(CAP);
  private stampN = 0;

  // Bullets (structure of arrays).
  nb = 0;
  readonly bx = new Float64Array(BCAP);
  readonly by = new Float64Array(BCAP);
  readonly bvx = new Float64Array(BCAP);
  readonly bvy = new Float64Array(BCAP);
  readonly blife = new Float64Array(BCAP);
  readonly bdmg = new Float64Array(BCAP);
  readonly bpierce = new Int32Array(BCAP);
  readonly bsplash = new Float64Array(BCAP);
  readonly bslow = new Float64Array(BCAP);
  readonly bignore = new Uint8Array(BCAP);
  /** 0..4 weapon look, 5 mech shell. */
  readonly blook = new Uint8Array(BCAP);
  private bhits = new Int32Array(BCAP * PIERCE_SLOTS);
  private bhitN = new Uint8Array(BCAP);

  gates: Gate[] = [];
  prizes: Prize[] = [];
  walls: WallData[];
  mech: Mech | null = null;
  boss: BossLike | null = null;
  hazards: Hazard[] = [];
  missiles: Missile[] = [];
  throws: Throw[] = [];
  barricades: Barricade[] = [];

  abilityCd = 0;
  abilityMax: number;
  novaT = 0;
  overT = 0;

  fx: Fx[] = [];
  fxOn = true;

  kills = 0;
  lostSoldiers = 0;
  peak = 0;

  private waves: WaveData[];
  private waveIdx = 0;
  private cand: number[] = [];
  private candT: number[] = [];

  constructor(level: LevelData, lo: Loadout, perks: Perks, seed = 1) {
    this.level = level;
    this.lo = lo;
    this.stats = runStats(level.start, lo, perks);
    this.rng = new Rng(seed);
    this.weapon = lo.weapon;
    this.scrollNow = level.scroll;
    this.abilityMax = ABILITIES[lo.ability].cooldown * this.stats.cooldown;
    this.abilityCd = this.abilityMax * 0.35;

    this.world = new World({
      capacity: CAP, dt: DT, cellSize: 16, maxSpeed: 1400, maxSubsteps: 8,
      detectTetherTouch: false, pairCorrection: 0.6, contactCapacity: 64,
    });

    // Track edges and walls.
    const len = level.length + 2000;
    this.world.addCollider({ pieces: [segment(-TRACK_HALF - 3, -800, -TRACK_HALF - 3, len, 3), segment(TRACK_HALF + 3, -800, TRACK_HALF + 3, len, 3)], restitution: 0, layer: L_WALL });
    this.walls = (level.walls ?? []).map((w) => ({ ...w }));
    for (const w of this.walls) {
      this.world.addCollider({
        pieces: box(w.x1 - w.x0, w.h, 2), x: (w.x0 + w.x1) / 2, y: w.y + w.h / 2, restitution: 0, layer: L_WALL,
      });
    }

    // Gates. Gates at the same y share a row.
    const rows = new Map<number, number>();
    (level.gates ?? []).forEach((g, id) => {
      if (!rows.has(g.y)) rows.set(g.y, rows.size);
      const mods = parseMods(g.m);
      this.gates.push({
        id, row: rows.get(g.y)!, x: g.x, baseX: g.x, y: g.y, w: g.w ?? 130, mods,
        alt: g.alt ? parseMods(g.alt) : null, period: g.period ?? 2, flipped: false,
        shoot: g.shoot ?? 0, max: g.max ?? 99, progress: 0, move: g.move ?? null, vy: 0,
        used: false, gone: false, passed: false, tone: toneOf(mods), flash: 0, stolen: false,
      });
    });

    this.prizes = (level.prizes ?? []).map((p) => ({ x: p.x, y: p.y, w: 64, h: 56, hp: p.hp, maxHp: p.hp, reward: p.r, state: 'frozen' as const, flash: 0 }));
    this.waves = [...(level.waves ?? [])].sort((a, b) => a.y - b.y);

    this.addSoldiers(this.stats.start, true);
    this.peak = this.soldiers.length;
  }

  /* ---------------------------- Queries --------------------------- */

  get count(): number { return this.soldiers.length; }

  /** Radius of the formation right now. */
  get formationR(): number { return SLOT_SPACING * dmath.sqrt(this.soldiers.length + 0.35) + this.stats.soldierR; }

  get progress(): number { return Math.min(1, this.squadY / this.level.length); }

  weaponDef() { return WEAPONS[this.weapon]; }

  emit(t: string, x: number, y: number, v?: number, s?: string, k?: string): void {
    if (this.fxOn) this.fx.push({ t, x, y, v, s, k });
  }

  /** Free span of track at band [y0, y1] containing x (walls removed). */
  freeSpan(y0: number, y1: number, x: number, pad: number): [number, number] {
    let lo = -TRACK_HALF, hi = TRACK_HALF;
    for (let it = 0; it < 4; it++) {
      lo = -TRACK_HALF; hi = TRACK_HALF;
      let inside: WallData | null = null;
      for (const w of this.walls) {
        if (w.y > y1 || w.y + w.h < y0) continue;
        if (w.x1 <= x) lo = Math.max(lo, w.x1);
        else if (w.x0 >= x) hi = Math.min(hi, w.x0);
        else inside = w;
      }
      if (!inside) break;
      x = x - inside.x0 < inside.x1 - x ? inside.x0 - 0.01 : inside.x1 + 0.01;
      if (x < -TRACK_HALF) x = inside.x1 + 0.01;
      if (x > TRACK_HALF) x = inside.x0 - 0.01;
    }
    return [lo + pad, Math.max(lo + pad, hi - pad)];
  }

  /** Enemies whose hash cells overlap the box. Each appears once. */
  queryEnemies(x0: number, y0: number, x1: number, y1: number, out: number[]): void {
    out.length = 0;
    const h = this.hash;
    const n = ++this.stampN;
    const cx0 = h.cellOf(x0), cx1 = h.cellOf(x1), cy0 = h.cellOf(y0), cy1 = h.cellOf(y1);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const lo = h.bucketLo(cx, cy), hi = h.bucketHi(cx, cy);
        for (let e = lo; e < hi; e++) {
          if (h.entryCx[e] !== cx || h.entryCy[e] !== cy) continue;
          const i = h.entryItem[e];
          if (this.stamp[i] === n) continue;
          this.stamp[i] = n;
          if (!this.eDead[i]) out.push(i);
        }
      }
    }
  }

  /* ---------------------------- Squad ----------------------------- */

  addSoldiers(n: number, initial = false): number {
    const w = this.world;
    let added = 0;
    const [lo, hi] = this.freeSpan(this.squadY - 20, this.squadY + 20, this.leaderX, 6);
    for (let k = 0; k < n; k++) {
      if (this.soldiers.length >= MAX_SQUAD) break;
      const slot = this.soldiers.length;
      const sx = Math.min(hi, Math.max(lo, this.leaderX + SLOT_X[slot] * (initial ? 1 : 0.4) + this.rng.range(-3, 3)));
      const sy = this.squadY + SLOT_Y[slot] * (initial ? 1 : 0.4) + this.rng.range(-3, 3);
      const h = w.createBody({
        x: sx, y: sy, radius: this.stats.soldierR, mass: 1, restitution: 0,
        layer: L_SQUAD, mask: L_SQUAD | L_WALL, group: 1,
      });
      if (h < 0) break;
      const i = w.indexOf(h);
      w.soft[i] = initial ? 0 : 0.35;
      this.sHp[i] = this.stats.soldierHp;
      this.sFire[i] = this.rng.next();
      this.sDead[i] = 0;
      this.soldiers.push(i);
      added++;
    }
    this.peak = Math.max(this.peak, this.soldiers.length);
    return added;
  }

  /** Remove n soldiers from the outside of the formation. */
  removeSoldiers(n: number): void {
    for (let k = this.soldiers.length - 1; k >= 0 && n > 0; k--) {
      const i = this.soldiers[k];
      if (this.sDead[i]) continue;
      this.sDead[i] = 1;
      n--;
    }
    this.compactSoldiers();
  }

  killSoldier(i: number): void {
    if (this.sDead[i]) return;
    this.sDead[i] = 1;
  }

  /** Kills up to `cap` soldiers matching the test. Returns how many. */
  killSoldiersWhere(test: (x: number, y: number) => boolean, cap: number): number {
    let n = 0;
    for (const i of this.soldiers) {
      if (n >= cap) break;
      if (this.sDead[i]) continue;
      if (test(this.world.x[i], this.world.y[i])) { this.sDead[i] = 1; n++; }
    }
    if (n > 0) this.compactSoldiers();
    return n;
  }

  private compactSoldiers(): void {
    const w = this.world;
    let k = 0;
    let downs = 0;
    for (const i of this.soldiers) {
      if (this.sDead[i]) {
        if (downs++ < 24) this.emit('down', w.x[i], w.y[i]);
        w.destroyIndex(i);
        this.sDead[i] = 0;
        this.lostSoldiers++;
      } else this.soldiers[k++] = i;
    }
    this.soldiers.length = k;
  }

  /* ---------------------------- Enemies --------------------------- */

  spawnEnemy(kind: EnemyKind, x: number, y: number, immune = 0): number {
    const d = ENEMIES[kind];
    x = Math.max(-TRACK_HALF + d.r, Math.min(TRACK_HALF - d.r, x));
    const h = this.world.createBody({
      x, y, radius: d.r, mass: d.r * d.r, restitution: 0,
      layer: L_ENEMY, mask: L_ENEMY | L_WALL, group: 2,
    });
    if (h < 0) return -1;
    const i = this.world.indexOf(h);
    this.eKind[i] = KIND_IDX[kind];
    this.eHp[i] = d.hp;
    this.eMaxHp[i] = d.hp;
    this.eShield[i] = d.shield;
    this.eBites[i] = d.bites;
    this.eSlow[i] = 0;
    this.eFlash[i] = 0;
    this.eImmune[i] = immune;
    this.eLaneX[i] = x;
    this.eBiteCd[i] = 0;
    this.eDead[i] = 0;
    this.eTarget[i] = -1;
    this.enemies.push(i);
    return i;
  }

  kindOf(i: number): EnemyKind { return KINDS[this.eKind[i]]; }

  spawnWave(w: { t: EnemyKind; n: number; f?: Formation; x?: number; w?: number; d?: number }, y: number): void {
    const f = w.f ?? 'block';
    const cx = w.x ?? 0;
    const width = w.w ?? 160;
    const depth = w.d ?? 60;
    const r = this.rng;
    const n = w.n;
    if (f === 'line') {
      for (let k = 0; k < n; k++) this.spawnEnemy(w.t, cx - width / 2 + (n === 1 ? width / 2 : (k * width) / (n - 1)) + r.range(-2, 2), y + r.range(-3, 3));
    } else if (f === 'column') {
      for (let k = 0; k < n; k++) this.spawnEnemy(w.t, cx + r.range(-4, 4), y + (k * depth) / Math.max(1, n - 1));
    } else if (f === 'scatter') {
      for (let k = 0; k < n; k++) this.spawnEnemy(w.t, cx + r.range(-width / 2, width / 2), y + r.range(0, depth));
    } else {
      const cols = Math.max(1, Math.round(Math.sqrt((n * width) / Math.max(1, depth))));
      const rows = Math.ceil(n / cols);
      for (let k = 0; k < n; k++) {
        const c = k % cols, rr = Math.floor(k / cols);
        const px = cx - width / 2 + (cols === 1 ? width / 2 : (c * width) / (cols - 1));
        const py = y + (rows === 1 ? 0 : (rr * depth) / (rows - 1));
        this.spawnEnemy(w.t, px + r.range(-3, 3), py + r.range(-3, 3));
      }
    }
  }

  /** Damage an enemy. Returns damage dealt. */
  damageEnemy(i: number, dmg: number, opts: { angled?: boolean; splash?: boolean; ignoreArmor?: boolean; slow?: number }): number {
    if (this.eDead[i] || this.eImmune[i] > 0) return 0;
    const d = ENEMIES[KINDS[this.eKind[i]]];
    if (this.eShield[i] > 0 && !opts.angled && !opts.splash) {
      this.eShield[i] -= dmg;
      this.eFlash[i] = 0.06;
      this.emit('shield', this.world.x[i], this.world.y[i] + d.r);
      return -1;
    }
    const dealt = armored(dmg, d.armor, !!opts.ignoreArmor);
    this.eHp[i] -= dealt;
    this.eFlash[i] = 0.08;
    if (opts.slow) this.eSlow[i] = Math.max(this.eSlow[i], opts.slow);
    if (d.armor > 0 && !opts.ignoreArmor && dealt < dmg * 0.5) this.emit('clank', this.world.x[i], this.world.y[i]);
    if (this.eHp[i] <= 0) this.killEnemy(i, true, !!opts.splash);
    return dealt;
  }

  killEnemy(i: number, byDamage: boolean, bySplash = false): void {
    if (this.eDead[i]) return;
    this.eDead[i] = 1;
    const kind = KINDS[this.eKind[i]];
    const x = this.world.x[i], y = this.world.y[i];
    if (byDamage) {
      this.kills++;
      this.emit('kill', x, y, ENEMIES[kind].r, undefined, kind);
      const sp = ENEMIES[kind].split;
      if (sp) {
        const n = bySplash ? sp.n * 2 : sp.n;
        for (let k = 0; k < n; k++) {
          const a = (k / n) * dmath.TAU + this.rng.range(-0.4, 0.4);
          const c = this.spawnEnemy(sp.kind, x + dmath.cos(a) * 6, y + dmath.sin(a) * 6, 0.35);
          if (c >= 0) { this.world.vx[c] = dmath.cos(a) * 120; this.world.vy[c] = dmath.sin(a) * 120; }
        }
      }
    } else this.emit('poof', x, y, ENEMIES[kind].r, undefined, kind);
  }

  explode(x: number, y: number, r: number, dmg: number, fromPlayer = true): void {
    this.emit('boom', x, y, r);
    if (r >= 50) this.emit('shake', x, y, 6);
    this.queryEnemies(x - r - 16, y - r - 16, x + r + 16, y + r + 16, this.cand);
    for (const i of this.cand) {
      const dx = this.world.x[i] - x, dy = this.world.y[i] - y, rr = r + this.world.r[i];
      if (dx * dx + dy * dy <= rr * rr) this.damageEnemy(i, dmg, { splash: true });
    }
    if (!fromPlayer) return;
    for (const p of this.prizes) {
      if (p.state !== 'frozen') continue;
      if (Math.abs(p.x - x) < p.w / 2 + r && Math.abs(p.y - y) < p.h / 2 + r) this.hitPrize(p, dmg);
    }
    for (const g of this.gates) {
      if (g.gone || g.used || !this.gateAbsorbs(g)) continue;
      if (Math.abs(g.x - x) < g.w / 2 + r && Math.abs(g.y - y) < 10 + r) this.hitGate(g, dmg);
    }
    if (this.boss && !this.boss.dead) {
      const dx = this.boss.x - x, dy = this.boss.y - y, rr = r + this.boss.r;
      if (dx * dx + dy * dy <= rr * rr) this.boss.hit(this, dmg, { angled: true, splash: true, ignoreArmor: false });
    }
  }

  /* ---------------------------- Gates & prizes -------------------- */

  gateMods(g: Gate): Mod[] { return g.flipped && g.alt ? g.alt : g.mods; }

  /** Shootable gates soak up bullets until maxed. */
  gateAbsorbs(g: Gate): boolean {
    if (g.shoot <= 0 || (g.flipped && g.alt)) return false;
    const m = g.mods.find((m) => m.k === 'add' || m.k === 'mul') as { v: number } | undefined;
    return !!m && m.v < g.max;
  }

  hitGate(g: Gate, dmg: number): void {
    g.progress += dmg;
    g.flash = 0.06;
    const m = g.mods.find((m) => m.k === 'add' || m.k === 'mul') as { k: string; v: number } | undefined;
    if (!m) return;
    let ticked = false;
    while (g.progress >= g.shoot && m.v < g.max) {
      g.progress -= g.shoot;
      m.v += 1;
      if (m.k === 'add' && m.v === 0) m.v = 1;
      ticked = true;
    }
    if (ticked) {
      g.tone = toneOf(g.mods);
      this.emit('gateUp', g.x, g.y, g.id);
    }
  }

  hitPrize(p: Prize, dmg: number): void {
    if (p.state !== 'frozen') return;
    p.hp -= dmg * this.stats.prize;
    p.flash = 0.05;
    this.emit('ice', p.x + this.rng.range(-p.w / 2, p.w / 2), p.y - p.h / 2, p.hp / p.maxHp);
    if (p.hp <= 0) this.breakPrize(p);
  }

  private breakPrize(p: Prize): void {
    p.state = 'broken';
    p.hp = 0;
    this.emit('prize', p.x, p.y, 0, p.reward);
    this.emit('shake', p.x, p.y, 9);
    const [kind, arg] = p.reward.split(':');
    if (kind === 'mech') {
      this.mech = { x: p.x, y: p.y, hp: 12, maxHp: 12, fireT: 0, barrel: 0, flash: 0 };
      this.emit('pop', p.x, p.y + 30, 0, 'MECH!', 'good');
    } else if (kind === 'weapon') {
      this.weapon = arg as WeaponId;
      this.dmgMult *= 1.15;
      this.emit('pop', p.x, p.y + 30, 0, WEAPONS[this.weapon].name.toUpperCase() + '!', 'weapon');
    } else if (kind === 'soldiers') {
      const n = this.addSoldiers(Number(arg));
      this.emit('pop', p.x, p.y + 30, 0, `+${n}`, 'good');
    }
  }

  private applyGate(g: Gate): void {
    const before = this.soldiers.length;
    const mods = this.gateMods(g);
    for (const m of mods) {
      switch (m.k) {
        case 'add':
          if (m.v > 0) this.addSoldiers(Math.ceil(m.v * this.stats.addMul));
          else this.removeSoldiers(-m.v);
          break;
        case 'mul': this.addSoldiers(Math.round(this.soldiers.length * (m.v - 1))); break;
        case 'div': this.removeSoldiers(this.soldiers.length - Math.floor(this.soldiers.length / m.v)); break;
        case 'fire': this.fireMult *= m.v; break;
        case 'dmg': this.dmgMult *= m.v; break;
        case 'pierce': this.pierceAdd += m.v; break;
        case 'weapon': this.weapon = m.id; break;
      }
    }
    const tone = toneOf(mods);
    this.emit('gate', g.x, g.y, this.soldiers.length - before, mods.map(modLabel).join('  '), tone);
    if (tone === 'bad') this.emit('shake', g.x, g.y, 4);
  }

  /** Add a gate at runtime (boss arenas). Each call is its own row unless it shares a y with the previous one. */
  addGate(x: number, y: number, w: number, m: string, shoot: number, vy: number): Gate {
    const last = this.gates[this.gates.length - 1];
    const row = last && last.y === y ? last.row : (last ? last.row + 1 : 0) + 1000;
    const mods = parseMods(m);
    const g: Gate = {
      id: this.gates.length, row, x, baseX: x, y, w, mods, alt: null, period: 2, flipped: false,
      shoot, max: 99, progress: 0, move: null, vy, used: false, gone: false, passed: false,
      tone: toneOf(mods), flash: 0, stolen: false,
    };
    this.gates.push(g);
    return g;
  }

  /* ---------------------------- Abilities ------------------------- */

  useAbility(): boolean {
    if (this.abilityCd > 0 || this.result) return false;
    this.abilityCd = this.abilityMax;
    const x = this.leaderX, y = this.squadY;
    switch (this.lo.ability) {
      case 'grenade': {
        const dur = 0.55;
        this.throws.push({ x, y0: y + 10, y: y + 240 + this.scrollNow * dur, t: 0, dur });
        break;
      }
      case 'barricade': {
        const ahead = 165;
        const col = this.world.addCollider({
          pieces: [segment(-75, 0, 75, 0, 6)], x, y: y + ahead, restitution: 0, layer: L_WALL, mask: L_ENEMY,
        });
        this.barricades.push({ col, x0: x - 75, x1: x + 75, ahead, t: 6 });
        break;
      }
      case 'nova': this.novaT = 3.5; this.emit('nova', x, y); break;
      case 'overclock': this.overT = 4; this.emit('overclock', x, y); break;
    }
    this.emit('ability', x, y, 0, this.lo.ability);
    return true;
  }

  /* ---------------------------- Step ------------------------------ */

  step(): void {
    if (!this.fxOn) this.fx.length = 0;
    if (this.result) return;
    const dt = DT;
    this.time += dt;
    const w = this.world;

    // Forward motion and boss arena lock.
    if (!this.locked) {
      this.squadY += this.scrollNow * dt;
      if (this.level.boss && this.squadY >= this.level.length) {
        this.squadY = this.level.length;
        this.locked = true;
        this.scrollNow = 0;
        this.boss = createBoss(this.level.boss.kind, this.level.boss.hp, this);
        this.emit('bossIn', 0, this.squadY + BOSS_AHEAD, 0, this.boss.name);
      }
    }

    // Leader.
    {
      const [lo, hi] = this.freeSpan(this.squadY - 12, this.squadY + 40, this.leaderX, 8);
      const tx = Math.max(lo, Math.min(hi, this.targetX));
      const maxStep = LEADER_SPEED * this.stats.move * dt;
      const d = tx - this.leaderX;
      this.leaderX += Math.max(-maxStep, Math.min(maxStep, d));
      this.leaderX = Math.max(lo, Math.min(hi, this.leaderX));
    }

    // Spawn waves that came into range.
    while (this.waveIdx < this.waves.length && this.waves[this.waveIdx].y - this.squadY <= SPAWN_AHEAD) {
      const wv = this.waves[this.waveIdx++];
      this.spawnWave(wv, wv.y);
    }

    // Timers.
    if (this.abilityCd > 0) this.abilityCd = Math.max(0, this.abilityCd - dt);
    if (this.novaT > 0) this.novaT -= dt;
    if (this.overT > 0) this.overT -= dt;

    this.steerSquad(dt);
    this.steerEnemies(dt);
    this.updateBarricades(dt);

    w.step();

    this.rebuildHash();
    if (this.boss && !this.boss.dead) this.boss.update(this, dt);
    this.fire(dt);
    this.moveBullets(dt);
    this.updateThrows(dt);
    this.updateMissiles(dt);
    this.updateHazards(dt);
    this.bites();
    this.updateGates(dt);
    this.updatePrizes(dt);
    this.cleanupEnemies();

    // End conditions.
    if (this.soldiers.length === 0) this.finish('lose');
    else if (this.boss ? this.boss.dead : this.squadY >= this.level.length) this.finish('win');
  }

  private finish(o: Outcome): void {
    this.result = o;
    if (o === 'win') {
      const n = this.soldiers.length;
      const hasPrize = this.prizes.length > 0;
      const s2 = hasPrize ? this.prizes.every((p) => p.state === 'broken') : n >= this.level.stars[0];
      const s3 = n >= this.level.stars[1];
      this.starFlags = [true, s2, s3];
      this.stars = 1 + (s2 ? 1 : 0) + (s3 ? 1 : 0);
    }
    this.emit(o, this.leaderX, this.squadY);
  }

  private steerSquad(dt: number): void {
    const w = this.world;
    const fr = this.formationR;
    const [lo, hi] = this.freeSpan(this.squadY - fr, this.squadY + fr, this.leaderX, this.stats.soldierR);
    const fwd = this.scrollNow;
    for (let k = 0; k < this.soldiers.length; k++) {
      const i = this.soldiers[k];
      const tx = Math.max(lo, Math.min(hi, this.leaderX + SLOT_X[k]));
      const ty = this.squadY + SLOT_Y[k];
      let vx = (tx - w.x[i]) * 11;
      let vy = (ty - w.y[i]) * 11 + fwd;
      const sp = vx * vx + vy * vy;
      if (sp > 900 * 900) { const s = 900 / dmath.sqrt(sp); vx *= s; vy *= s; }
      w.vx[i] = vx;
      w.vy[i] = vy;
    }
    if (this.mech) {
      const m = this.mech;
      const ty = this.squadY - fr * 0.7 - 22;
      m.x += (this.leaderX - m.x) * Math.min(1, dt * 6);
      m.y += (ty - m.y) * Math.min(1, dt * 6) + fwd * dt;
      if (m.flash > 0) m.flash -= dt;
    }
    void dt;
  }

  private steerEnemies(dt: number): void {
    const w = this.world;
    const slowAll = this.novaT > 0 ? 0.3 : 1;
    for (const i of this.enemies) {
      if (this.eDead[i]) continue;
      const d = ENEMIES[KINDS[this.eKind[i]]];
      if (this.eSlow[i] > 0) this.eSlow[i] -= dt;
      if (this.eFlash[i] > 0) this.eFlash[i] -= dt;
      if (this.eImmune[i] > 0) { this.eImmune[i] -= dt; continue; } // keep split burst velocity
      if (this.eBiteCd[i] > 0) this.eBiteCd[i] -= dt;
      const sp = d.speed * (this.eSlow[i] > 0 ? 0.45 : 1) * slowAll;
      const ex = w.x[i], ey = w.y[i];
      const dy = ey - this.squadY;
      let vx = 0;
      const vy = -sp;
      const lat = sp * d.lat;
      if (d.thief) {
        const g = this.thiefTarget(i);
        if (g) {
          vx = Math.max(-lat, Math.min(lat, (g.x - ex) * 3));
          w.vx[i] = vx; w.vy[i] = vy;
          continue;
        }
      }
      if (dy > d.home) {
        if (d.lane) vx = Math.max(-lat, Math.min(lat, (this.eLaneX[i] - ex) * 2));
      } else {
        const strength = dy < 0 ? 4 : 2.5;
        vx = Math.max(-lat, Math.min(lat, (this.leaderX - ex) * strength));
      }
      w.vx[i] = vx;
      w.vy[i] = vy;
    }
  }

  private thiefTarget(i: number): Gate | null {
    const t = this.eTarget[i];
    const cur = t >= 0 ? this.gates[t] : null;
    const ey = this.world.y[i];
    if (cur && !cur.gone && !cur.used && !cur.passed && cur.y < ey + 5 && cur.tone !== 'bad' && !cur.stolen) return cur;
    let best: Gate | null = null;
    let bd = Infinity;
    const ex = this.world.x[i];
    for (const g of this.gates) {
      if (g.gone || g.used || g.passed || g.stolen || g.tone === 'bad' || g.tone === 'weapon') continue;
      if (g.y > ey || g.y < this.squadY + 30) continue;
      const d = (ey - g.y) + Math.abs(g.x - ex) * 1.5;
      if (d < bd) { bd = d; best = g; }
    }
    this.eTarget[i] = best ? best.id : -1;
    return best;
  }

  private updateBarricades(dt: number): void {
    for (const b of this.barricades) {
      b.t -= dt;
      // Moves with the squad so it keeps holding the line ahead.
      this.world.setColliderVelocity(b.col, 0, this.scrollNow, 0);
    }
    for (let k = this.barricades.length - 1; k >= 0; k--) {
      if (this.barricades[k].t <= 0) {
        this.world.removeCollider(this.barricades[k].col);
        this.barricades.splice(k, 1);
      }
    }
  }

  barricadeY(b: Barricade): number {
    return this.world.colY[b.col];
  }

  private rebuildHash(): void {
    const h = this.hash;
    const w = this.world;
    h.begin();
    for (const i of this.enemies) {
      if (this.eDead[i]) continue;
      const r = w.r[i];
      h.add(i, w.x[i] - r, w.y[i] - r, w.x[i] + r, w.y[i] + r);
    }
    h.build();
  }

  /* ---------------------------- Firing ---------------------------- */

  private fire(dt: number): void {
    const wd = WEAPONS[this.weapon];
    const dirs = PELLET_DIRS[this.weapon];
    const rate = wd.rate * this.fireMult * this.stats.fire * (this.overT > 0 ? 2 : 1);
    const dmg = wd.dmg * this.dmgMult * this.stats.dmg;
    const pierce = wd.pierce + this.pierceAdd;
    const look = ['rifle', 'spread', 'piercer', 'launcher', 'frost'].indexOf(wd.id);
    const w = this.world;
    for (const i of this.soldiers) {
      this.sFire[i] -= dt * rate;
      while (this.sFire[i] <= 0) {
        this.sFire[i] += 1;
        for (const d of dirs) {
          const jit = this.rng.range(-0.025, 0.025);
          this.addBullet(w.x[i], w.y[i] + 6, (d.x + jit) * wd.speed, d.y * wd.speed, wd.life, dmg, pierce, wd.splash, wd.slow, wd.ignoreArmor, look);
        }
      }
    }
    const m = this.mech;
    if (m) {
      m.fireT -= dt * 2.2;
      while (m.fireT <= 0) {
        m.fireT += 1;
        m.barrel ^= 1;
        this.addBullet(m.x + (m.barrel ? 9 : -9), m.y + 18, 0, 900, 0.75, 5 * this.stats.dmg, 3, 0, 0, true, 5);
      }
    }
  }

  private addBullet(x: number, y: number, vx: number, vy: number, life: number, dmg: number, pierce: number, splash: number, slow: number, ignore: boolean, look: number): void {
    if (this.nb >= BCAP) return;
    const b = this.nb++;
    this.bx[b] = x; this.by[b] = y; this.bvx[b] = vx; this.bvy[b] = vy;
    this.blife[b] = life; this.bdmg[b] = dmg; this.bpierce[b] = pierce;
    this.bsplash[b] = splash; this.bslow[b] = slow; this.bignore[b] = ignore ? 1 : 0;
    this.blook[b] = look; this.bhitN[b] = 0;
  }

  private removeBullet(b: number): void {
    const last = --this.nb;
    if (b === last) return;
    this.bx[b] = this.bx[last]; this.by[b] = this.by[last];
    this.bvx[b] = this.bvx[last]; this.bvy[b] = this.bvy[last];
    this.blife[b] = this.blife[last]; this.bdmg[b] = this.bdmg[last];
    this.bpierce[b] = this.bpierce[last]; this.bsplash[b] = this.bsplash[last];
    this.bslow[b] = this.bslow[last]; this.bignore[b] = this.bignore[last];
    this.blook[b] = this.blook[last]; this.bhitN[b] = this.bhitN[last];
    for (let s = 0; s < PIERCE_SLOTS; s++) this.bhits[b * PIERCE_SLOTS + s] = this.bhits[last * PIERCE_SLOTS + s];
  }

  private moveBullets(dt: number): void {
    const w = this.world;
    const cand = this.cand, candT = this.candT;
    let hitFx = 0;
    for (let b = 0; b < this.nb; ) {
      this.blife[b] -= dt;
      if (this.blife[b] <= 0) { this.removeBullet(b); continue; }
      const x = this.bx[b], y = this.by[b];
      const dx = this.bvx[b] * dt, dy = this.bvy[b] * dt;

      // Nearest solid obstacle along the path.
      let tObs = 2;
      let obsKind = 0; // 1 wall, 2 gate, 3 prize, 4 boss, 5 missile
      let obsRef: Gate | Prize | Missile | null = null;
      for (const wl of this.walls) {
        const t = segRect(x, y, dx, dy, wl.x0, wl.y, wl.x1, wl.y + wl.h);
        if (t >= 0 && t < tObs) { tObs = t; obsKind = 1; }
      }
      for (const g of this.gates) {
        if (g.gone || g.used || !this.gateAbsorbs(g)) continue;
        if (Math.abs(g.y - y) > 40) continue;
        const t = segRect(x, y, dx, dy, g.x - g.w / 2, g.y - 9, g.x + g.w / 2, g.y + 9);
        if (t >= 0 && t < tObs) { tObs = t; obsKind = 2; obsRef = g; }
      }
      for (const p of this.prizes) {
        if (p.state !== 'frozen' || Math.abs(p.y - y) > 80) continue;
        const t = segRect(x, y, dx, dy, p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2);
        if (t >= 0 && t < tObs) { tObs = t; obsKind = 3; obsRef = p; }
      }
      const boss = this.boss;
      if (boss && !boss.dead) {
        const t = segCircle(x, y, dx, dy, boss.x, boss.y, boss.r);
        if (t >= 0 && t < tObs) { tObs = t; obsKind = 4; }
      }
      for (const m of this.missiles) {
        if (m.dead || m.hp <= 0) continue;
        const t = segCircle(x, y, dx, dy, m.x, m.y, m.r + 2);
        if (t >= 0 && t < tObs) { tObs = t; obsKind = 5; obsRef = m; }
      }

      // Enemies along the path, nearest first.
      this.queryEnemies(Math.min(x, x + dx) - 16, Math.min(y, y + dy) - 16, Math.max(x, x + dx) + 16, Math.max(y, y + dy) + 16, cand);
      let nHit = 0;
      const base = b * PIERCE_SLOTS;
      for (const i of cand) {
        if (this.eImmune[i] > 0) continue;
        let seen = false;
        for (let s = 0; s < this.bhitN[b]; s++) if (this.bhits[base + s] === i) { seen = true; break; }
        if (seen) continue;
        const t = segCircle(x, y, dx, dy, w.x[i], w.y[i], w.r[i] + 1.5);
        if (t < 0 || t >= tObs) continue;
        // insertion sort by t into the front of cand/candT
        let j = nHit++;
        candT[j] = t;
        cand[j] = i;
        while (j > 0 && candT[j - 1] > t) {
          candT[j] = candT[j - 1]; cand[j] = cand[j - 1];
          candT[j - 1] = t; cand[j - 1] = i;
          j--;
        }
      }

      let consumed = false;
      const dmg = this.bdmg[b];
      const angled = Math.abs(this.bvx[b]) > Math.abs(this.bvy[b]) * 0.2;
      for (let k = 0; k < nHit && !consumed; k++) {
        const i = cand[k];
        const t = candT[k];
        const hx = x + dx * t, hy = y + dy * t;
        if (this.bsplash[b] > 0) {
          this.explode(hx, hy, this.bsplash[b], dmg);
          consumed = true;
          break;
        }
        const r = this.damageEnemy(i, dmg, { angled, ignoreArmor: this.bignore[b] === 1, slow: this.bslow[b] });
        if (hitFx++ < 40) this.emit('hit', hx, hy, this.blook[b]);
        if (r < 0) { consumed = true; break; } // shield
        if (this.bhitN[b] < PIERCE_SLOTS) this.bhits[base + this.bhitN[b]++] = i;
        if (this.bpierce[b]-- <= 0) consumed = true;
      }
      if (!consumed && tObs <= 1) {
        const hx = x + dx * tObs, hy = y + dy * tObs;
        consumed = true;
        if (this.bsplash[b] > 0) this.explode(hx, hy, this.bsplash[b], dmg);
        else if (obsKind === 2) this.hitGate(obsRef as Gate, dmg);
        else if (obsKind === 3) this.hitPrize(obsRef as Prize, dmg);
        else if (obsKind === 4 && boss) {
          const r = boss.hit(this, dmg, { angled, splash: false, ignoreArmor: this.bignore[b] === 1, slow: this.bslow[b] });
          if (hitFx++ < 40) this.emit(r > 0 ? 'hit' : 'shield', hx, hy, this.blook[b]);
        } else if (obsKind === 5) {
          const m = obsRef as Missile;
          m.hp -= dmg;
          if (m.hp <= 0) { m.dead = true; this.emit('pop', m.x, m.y, 0, '', 'egg'); this.emit('kill', m.x, m.y, m.r, undefined, 'egg'); }
        } else if (hitFx++ < 40) this.emit('spark', hx, hy);
      }
      if (consumed) { this.removeBullet(b); continue; }
      this.bx[b] = x + dx;
      this.by[b] = y + dy;
      b++;
    }
  }

  private updateThrows(dt: number): void {
    for (let k = this.throws.length - 1; k >= 0; k--) {
      const g = this.throws[k];
      g.t += dt;
      if (g.t >= g.dur) {
        this.explode(g.x, g.y, 72, 22);
        this.emit('shake', g.x, g.y, 8);
        this.throws.splice(k, 1);
      }
    }
  }

  private updateMissiles(dt: number): void {
    for (const m of this.missiles) {
      if (m.dead) continue;
      m.x += m.vx * dt;
      m.y += m.vy * dt;
      if (m.kind === 'egg') {
        if (m.y <= m.landY) {
          m.dead = true;
          this.emit('splat', m.x, m.y, m.r);
          this.spawnEnemy('splitter', m.x, m.y);
        }
        continue;
      }
      // Spears and rocks hurt soldiers they touch.
      if (m.kill > 0) {
        const rr = m.r + this.stats.soldierR;
        const n = this.killSoldiersWhere((sx, sy) => (sx - m.x) ** 2 + (sy - m.y) ** 2 < rr * rr, m.kill);
        m.kill -= n;
        if (n > 0) this.emit('shake', m.x, m.y, 3);
      }
      if (m.y < this.squadY - DESPAWN_BEHIND || m.kill <= 0) m.dead = true;
    }
    if (this.missiles.length) this.missiles = this.missiles.filter((m) => !m.dead);
  }

  /** Telegraph an attack: after `dur` seconds `fire` runs. */
  telegraph(h: Omit<Hazard, 't' | 'done'>): Hazard {
    const hz: Hazard = { ...h, t: 0, done: false };
    this.hazards.push(hz);
    return hz;
  }

  private updateHazards(dt: number): void {
    const slow = this.novaT > 0 ? 0.5 : 1;
    for (const h of this.hazards) {
      h.t += dt * slow;
      if (h.t >= h.dur && !h.done) {
        h.done = true;
        h.fire(this);
      }
    }
    if (this.hazards.length) this.hazards = this.hazards.filter((h) => !h.done);
  }

  private bites(): void {
    const w = this.world;
    const cand = this.cand;
    let any = false;
    for (const s of this.soldiers) {
      const sx = w.x[s], sy = w.y[s], sr = w.r[s];
      this.queryEnemies(sx - sr - 16, sy - sr - 16, sx + sr + 16, sy + sr + 16, cand);
      for (const e of cand) {
        if (this.eBiteCd[e] > 0 || this.eImmune[e] > 0) continue;
        const rr = sr + w.r[e] + 1.5;
        const dx = w.x[e] - sx, dy = w.y[e] - sy;
        if (dx * dx + dy * dy > rr * rr) continue;
        this.eBites[e] -= 1;
        this.eBiteCd[e] = 0.25;
        this.sHp[s] -= 1;
        if (this.sHp[s] <= 0) { this.sDead[s] = 1; any = true; }
        if (this.eBites[e] <= 0) this.killEnemy(e, false);
        break;
      }
    }
    if (any) this.compactSoldiers();
    const m = this.mech;
    if (m) {
      this.queryEnemies(m.x - 34, m.y - 34, m.x + 34, m.y + 34, cand);
      for (const e of cand) {
        if (this.eBiteCd[e] > 0) continue;
        const rr = 16 + w.r[e];
        const dx = w.x[e] - m.x, dy = w.y[e] - m.y;
        if (dx * dx + dy * dy > rr * rr) continue;
        m.hp -= 1;
        m.flash = 0.1;
        this.eBites[e] -= 1;
        this.eBiteCd[e] = 0.25;
        if (this.eBites[e] <= 0) this.killEnemy(e, false);
      }
      if (m.hp <= 0) {
        this.emit('boom', m.x, m.y, 40);
        this.emit('shake', m.x, m.y, 7);
        this.emit('pop', m.x, m.y + 20, 0, 'MECH DOWN', 'bad');
        this.mech = null;
      }
    }
  }

  private updateGates(dt: number): void {
    const w = this.world;
    for (const g of this.gates) {
      if (g.flash > 0) g.flash -= dt;
      if (g.gone || g.used) continue;
      if (g.move) g.x = g.baseX + g.move[0] * dmath.sin((dmath.TAU * this.time) / g.move[1]);
      if (g.alt) {
        const f = Math.floor(this.time / g.period) % 2 === 1;
        if (f !== g.flipped) { g.flipped = f; g.tone = toneOf(this.gateMods(g)); }
      }
      if (g.vy) g.y += g.vy * dt;
      // Thieves that reach a gate turn it bad.
      if (!g.passed && g.tone !== 'bad' && g.tone !== 'weapon' && g.y - this.squadY < 700) {
        for (const i of this.enemies) {
          if (this.eDead[i] || !ENEMIES[KINDS[this.eKind[i]]].thief) continue;
          if (Math.abs(w.x[i] - g.x) < g.w / 2 && Math.abs(w.y[i] - g.y) < 12) {
            this.stealGate(g);
            this.killEnemy(i, false);
            break;
          }
        }
      }
      if (!g.passed && g.y <= this.squadY) {
        g.passed = true;
        if (Math.abs(this.leaderX - g.x) <= g.w / 2) {
          g.used = true;
          this.applyGate(g);
          for (const o of this.gates) if (o !== g && o.row === g.row && !o.passed) o.gone = true;
        }
      }
    }
  }

  stealGate(g: Gate): void {
    const flip = (m: Mod): Mod => {
      switch (m.k) {
        case 'add': return { k: 'add', v: -Math.abs(m.v) };
        case 'mul': return { k: 'div', v: Math.max(2, Math.round(m.v)) };
        case 'fire': case 'dmg': return { k: m.k, v: m.v > 1 ? 1 / m.v : m.v };
        default: return m;
      }
    };
    g.mods = g.mods.map(flip);
    if (g.alt) g.alt = g.alt.map(flip);
    g.tone = toneOf(this.gateMods(g));
    g.stolen = true;
    g.flash = 0.3;
    this.emit('stolen', g.x, g.y);
  }

  private updatePrizes(dt: number): void {
    for (const p of this.prizes) {
      if (p.flash > 0) p.flash -= dt;
      if (p.state === 'frozen' && p.y + p.h / 2 < this.squadY - 30) {
        p.state = 'lost';
        this.emit('prizeLost', p.x, p.y);
      }
    }
  }

  private cleanupEnemies(): void {
    const w = this.world;
    let k = 0;
    for (const i of this.enemies) {
      if (!this.eDead[i] && w.y[i] < this.squadY - DESPAWN_BEHIND) this.eDead[i] = 1;
      if (this.eDead[i]) w.destroyIndex(i);
      else this.enemies[k++] = i;
    }
    this.enemies.length = k;
  }
}
