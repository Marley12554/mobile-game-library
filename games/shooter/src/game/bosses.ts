import { dmath } from '@engine/index';
import { BOSS_AHEAD, TRACK_HALF } from './config';
import type { BossKind } from './types';
import type { Sim } from './sim';
import { armored } from './weapons';

export interface HitOpts { angled: boolean; splash: boolean; ignoreArmor: boolean; slow?: number }

export interface BossLike {
  kind: BossKind;
  name: string;
  x: number;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  dead: boolean;
  flash: number;
  armor: number;
  /** Straight shots bounce off. */
  shieldUp: boolean;
  /** Weak spot open: no armor, extra damage. */
  vent: boolean;
  /** For the renderer: 'enter' | 'idle' | 'charge' | 'windup' | ... */
  state: string;
  update(sim: Sim, dt: number): void;
  /** Damage dealt (0 if blocked). */
  hit(sim: Sim, dmg: number, o: HitOpts): number;
}

const LANE_W = (TRACK_HALF * 2) / 3;
export const laneCenter = (i: number) => -TRACK_HALF + LANE_W * (i + 0.5);
export const laneOf = (x: number) => Math.max(0, Math.min(2, Math.floor((x + TRACK_HALF) / LANE_W)));

abstract class Boss implements BossLike {
  abstract kind: BossKind;
  abstract name: string;
  x = 0;
  y: number;
  r: number;
  hp: number;
  maxHp: number;
  dead = false;
  flash = 0;
  armor = 0;
  shieldUp = false;
  vent = false;
  state = 'enter';
  protected t = 0;
  protected slowT = 0;
  protected timers: Record<string, number> = {};

  constructor(hp: number, r: number, sim: Sim) {
    this.hp = hp;
    this.maxHp = hp;
    this.r = r;
    this.y = sim.squadY + BOSS_AHEAD + 260;
  }

  get enraged(): boolean { return this.hp < this.maxHp * 0.5; }
  homeY(sim: Sim): number { return sim.squadY + BOSS_AHEAD; }

  /** True once every `period` seconds, first after `first`. */
  protected every(name: string, period: number, first: number, dt: number): boolean {
    if (this.timers[name] === undefined) this.timers[name] = first;
    this.timers[name] -= dt;
    if (this.timers[name] <= 0) { this.timers[name] += period; return true; }
    return false;
  }

  hit(sim: Sim, dmg: number, o: HitOpts): number {
    if (this.dead || this.state === 'enter') return 0;
    if (this.shieldUp && !o.angled && !o.splash) { this.flash = 0.03; return 0; }
    const d = armored(dmg, this.vent ? 0 : this.armor, o.ignoreArmor) * (this.vent ? 1.5 : 1);
    if (o.slow) this.slowT = Math.max(this.slowT, o.slow);
    this.hp -= d;
    this.flash = 0.05;
    if (this.hp <= 0) this.die(sim);
    return d;
  }

  protected die(sim: Sim): void {
    this.hp = 0;
    this.dead = true;
    this.state = 'dead';
    sim.emit('bossDown', this.x, this.y, this.r);
    sim.emit('shake', this.x, this.y, 14);
    for (const i of sim.enemies) sim.killEnemy(i, false);
    sim.hazards.length = 0;
    for (const m of sim.missiles) m.dead = true;
  }

  update(sim: Sim, dt: number): void {
    if (this.flash > 0) this.flash -= dt;
    if (this.slowT > 0) this.slowT -= dt;
    const ts = (sim.novaT > 0 ? 0.5 : 1) * (this.slowT > 0 ? 0.7 : 1);
    if (this.state === 'enter') {
      this.y -= 150 * dt;
      if (this.y <= this.homeY(sim)) { this.y = this.homeY(sim); this.state = 'idle'; }
      return;
    }
    this.t += dt * ts;
    this.fight(sim, dt * ts);
  }

  protected abstract fight(sim: Sim, dt: number): void;

  /** Ease x toward a target. */
  protected slide(tx: number, rate: number, dt: number): void {
    this.x += (tx - this.x) * Math.min(1, rate * dt);
  }

  /** Telegraph a full-height lane strip from the squad line up to the boss. */
  protected laneWarn(sim: Sim, lane: number, dur: number, fire: (s: Sim) => void, y0 = -70, y1 = 0): void {
    const cx = laneCenter(lane);
    sim.telegraph({
      kind: 'rect', x0: cx - LANE_W / 2 + 4, x1: cx + LANE_W / 2 - 4,
      y0: sim.squadY + y0, y1: y1 ? sim.squadY + y1 : this.y, cx, cy: 0, r: 0, dur, fire,
    });
  }
}

/* -------------------------------------------------------------- */
/* World 1: Brute King. Telegraphed lane charges + zombie summons. */
/* -------------------------------------------------------------- */
class BruteKing extends Boss {
  kind: BossKind = 'bruteKing';
  name = 'Brute King';
  protected summons = true;
  private chargeX = 0;
  private chargeVy = 0;
  private chargeKills = 0;
  private pending = 0;

  constructor(hp: number, sim: Sim) { super(hp, 30, sim); }

  protected fight(sim: Sim, dt: number): void {
    const home = this.homeY(sim);
    if (this.state === 'windup') {
      this.slide(this.chargeX, 6, dt);
      return;
    }
    if (this.state === 'charge') {
      this.x = this.chargeX;
      this.y += this.chargeVy * dt;
      const rr = this.r + 6;
      const n = this.killSoldiers(sim, rr, 18 - this.chargeKills);
      this.chargeKills += n;
      if (this.y <= sim.squadY - 50) { this.state = 'return'; this.chargeVy = 0; sim.emit('shake', this.x, this.y, 10); }
      return;
    }
    if (this.state === 'return') {
      this.y += 320 * dt;
      if (this.y >= home) {
        this.y = home;
        if (this.pending > 0) { this.pending--; this.windup(sim); }
        else this.state = 'idle';
      }
      return;
    }
    this.slide(95 * dmath.sin(this.t * 0.6), 2, dt);
    const rage = this.enraged;
    if (this.summons && this.every('summon', rage ? 2.6 : 3.4, 1.2, dt)) {
      sim.spawnWave({ t: 'zombie', n: rage ? 9 : 7, f: 'block', x: this.x, w: 90, d: 30 }, this.y - this.r - 10);
      if (rage) sim.spawnWave({ t: 'runner', n: 4, f: 'column', x: laneCenter(sim.rng.int(3)), d: 50 }, this.y);
      sim.emit('roar', this.x, this.y);
    }
    if (this.every('charge', rage ? 5 : 6.5, 4, dt)) {
      this.pending = rage ? 1 : 0;
      this.windup(sim);
    }
  }

  private windup(sim: Sim): void {
    const lane = laneOf(sim.leaderX);
    this.chargeX = laneCenter(lane);
    this.state = 'windup';
    this.laneWarn(sim, lane, this.enraged ? 0.85 : 1.15, () => {
      this.state = 'charge';
      this.chargeVy = -620;
      this.chargeKills = 0;
      sim.emit('roar', this.x, this.y);
    });
  }

  protected killSoldiers(sim: Sim, rr: number, cap: number): number {
    if (cap <= 0) return 0;
    return sim.killSoldiersWhere((x, y) => (x - this.x) ** 2 + (y - this.y) ** 2 < rr * rr, cap);
  }
}

/* -------------------------------------------------------------- */
/* World 2: Iron Hulk. Armored; vents open on a rhythm; two-lane slams. */
/* -------------------------------------------------------------- */
class IronHulk extends Boss {
  kind: BossKind = 'ironHulk';
  name = 'Iron Hulk';
  private ventT = 0;

  constructor(hp: number, sim: Sim) { super(hp, 34, sim); this.armor = 1.0; }

  protected fight(sim: Sim, dt: number): void {
    const rage = this.enraged;
    this.slide(70 * dmath.sin(this.t * 0.4), 1.5, dt);
    if (this.ventT > 0) {
      this.ventT -= dt;
      if (this.ventT <= 0) { this.vent = false; this.state = 'idle'; }
    }
    if (this.every('vent', 8, 3, dt)) {
      this.vent = true;
      this.ventT = 2.4;
      this.state = 'vent';
      sim.emit('vent', this.x, this.y);
    }
    if (this.every('slam', rage ? 3.9 : 5.2, 2, dt)) {
      const safe = sim.rng.int(3);
      for (let l = 0; l < 3; l++) {
        if (l === safe) continue;
        this.laneWarn(sim, l, rage ? 1.0 : 1.3, (s) => {
          const cx = laneCenter(l);
          s.killSoldiersWhere((x) => Math.abs(x - cx) < LANE_W / 2, 30);
          s.emit('slam', cx, s.squadY);
          s.emit('shake', cx, s.squadY, 9);
        }, -80, 70);
      }
    }
    if (this.every('summon', 9, 1, dt)) {
      sim.spawnWave({ t: 'armored', n: 5, f: 'line', x: 0, w: 260 }, this.y - 50);
      if (rage) sim.spawnWave({ t: 'zombie', n: 8, f: 'block', x: this.x, w: 120, d: 30 }, this.y - 20);
    }
  }
}

/* -------------------------------------------------------------- */
/* World 3: Brood Mother. Lobs eggs that hatch splitters. Shoot eggs down. */
/* -------------------------------------------------------------- */
class BroodMother extends Boss {
  kind: BossKind = 'broodMother';
  name = 'Brood Mother';
  private burst66 = false;
  private burst33 = false;

  constructor(hp: number, sim: Sim) { super(hp, 32, sim); }

  protected fight(sim: Sim, dt: number): void {
    const rage = this.enraged;
    this.slide(120 * dmath.sin(this.t * 0.5), 2.5, dt);
    if (this.every('eggs', rage ? 1.8 : 2.5, 1.5, dt)) {
      const n = rage ? 3 : 2;
      for (let k = 0; k < n; k++) {
        const tx = sim.rng.range(-TRACK_HALF + 20, TRACK_HALF - 20);
        const landY = sim.squadY + sim.rng.range(150, 270);
        const flight = 1.5;
        sim.missiles.push({
          kind: 'egg', x: this.x, y: this.y - 10, vx: (tx - this.x) / flight, vy: (landY - this.y + 10) / flight,
          r: 8, hp: 3, kill: 0, landY, dead: false,
        });
        sim.telegraph({ kind: 'circle', x0: 0, x1: 0, y0: 0, y1: 0, cx: tx, cy: landY, r: 16, dur: flight, fire: () => {} });
      }
      sim.emit('spit', this.x, this.y);
    }
    if (this.every('summon', 6, 3, dt)) sim.spawnWave({ t: 'zombie', n: 8, f: 'block', x: this.x, w: 110, d: 30 }, this.y - 30);
    const f = this.hp / this.maxHp;
    if ((!this.burst66 && f < 0.66) || (!this.burst33 && f < 0.33)) {
      if (f < 0.33) this.burst33 = true;
      this.burst66 = true;
      sim.spawnWave({ t: 'splitter', n: 5, f: 'line', x: this.x, w: 160 }, this.y - 40);
      sim.emit('roar', this.x, this.y);
      sim.emit('shake', this.x, this.y, 6);
    }
  }
}

/* -------------------------------------------------------------- */
/* World 4: Warden. Shield up; spear volleys down two lanes; shield drops after. */
/* -------------------------------------------------------------- */
class Warden extends Boss {
  kind: BossKind = 'warden';
  name = 'The Warden';
  private openT = 0;

  constructor(hp: number, sim: Sim) { super(hp, 30, sim); this.shieldUp = true; }

  protected fight(sim: Sim, dt: number): void {
    const rage = this.enraged;
    this.slide(80 * dmath.sin(this.t * 0.45), 2, dt);
    if (this.openT > 0) {
      this.openT -= dt;
      if (this.openT <= 0) { this.shieldUp = true; this.state = 'idle'; }
    }
    if (this.every('volley', rage ? 4.2 : 5.5, 2.5, dt)) {
      const safe = sim.rng.int(3);
      this.state = 'windup';
      for (let l = 0; l < 3; l++) {
        if (l === safe) continue;
        this.laneWarn(sim, l, rage ? 0.85 : 1.1, (s) => {
          const cx = laneCenter(l);
          for (let k = -1; k <= 1; k++) {
            s.missiles.push({ kind: 'spear', x: cx + k * 30, y: this.y - 20, vx: 0, vy: -720, r: 6, hp: 0, kill: 5, landY: 0, dead: false });
          }
          this.shieldUp = false;
          this.openT = 2.6;
          this.state = 'open';
          s.emit('spears', cx, this.y);
        });
      }
    }
    if (this.every('summon', 8, 1.5, dt)) {
      sim.spawnWave({ t: 'shielded', n: rage ? 5 : 4, f: 'line', x: 0, w: 220 }, this.y - 40);
      sim.spawnWave({ t: 'zombie', n: 6, f: 'block', x: this.x, w: 100, d: 30 }, this.y - 20);
    }
  }
}

/* -------------------------------------------------------------- */
/* World 5: Gate Eater. Drops gates, sends thieves, inhales gates to heal, charges. */
/* -------------------------------------------------------------- */
class GateEater extends BruteKing {
  override kind: BossKind = 'gateEater';
  override name = 'Gate Eater';
  private inhaleT = 0;

  constructor(hp: number, sim: Sim) { super(hp, sim); this.r = 36; this.armor = 0.3; this.summons = false; }

  protected override fight(sim: Sim, dt: number): void {
    if (this.state === 'idle' || this.state === 'inhale') {
      const rage = this.enraged;
      if (this.every('gates', 5, 1, dt)) {
        const goodLeft = sim.rng.chance(0.5);
        const y = this.y - 70;
        const good = sim.addGate(goodLeft ? -85 : 85, y, 140, '+4', 6, -55);
        good.max = 10;
        const bad = sim.addGate(goodLeft ? 85 : -85, y, 140, rage ? '-14' : '-10', 5, -55);
        bad.max = 4;
      }
      if (this.every('thieves', 7, 4, dt)) sim.spawnWave({ t: 'thief', n: rage ? 4 : 3, f: 'line', x: this.x, w: 120 }, this.y - 30);
      if (this.every('mix', 6, 2.5, dt)) {
        sim.spawnWave({ t: 'zombie', n: 8, f: 'block', x: -this.x, w: 120, d: 30 }, this.y - 20);
        sim.spawnWave({ t: rage ? 'armored' : 'runner', n: 4, f: rage ? 'line' : 'column', x: laneCenter(sim.rng.int(3)), w: 90, d: 60 }, this.y - 20);
      }
      if (this.every('inhale', 12, 9, dt)) {
        this.state = 'inhale';
        this.inhaleT = 2.2;
        sim.emit('pop', this.x, this.y - 50, 0, 'INHALE!', 'bad');
      }
      if (this.state === 'inhale') {
        this.inhaleT -= dt;
        for (const g of sim.gates) {
          if (g.gone || g.used || g.passed || g.vy === 0) continue;
          g.vy = 160;
          g.x += (this.x - g.x) * Math.min(1, dt * 1.2);
          if (g.y >= this.y - this.r) {
            g.gone = true;
            this.hp = Math.min(this.maxHp, this.hp + this.maxHp * 0.05);
            sim.emit('eat', this.x, this.y);
          }
        }
        if (this.inhaleT <= 0) {
          this.state = 'idle';
          for (const g of sim.gates) if (!g.gone && !g.used && !g.passed && g.vy > 0) g.vy = -55;
        }
        return;
      }
    }
    super.fight(sim, dt);
  }
}

export function createBoss(kind: BossKind, hp: number, sim: Sim): BossLike {
  switch (kind) {
    case 'bruteKing': return new BruteKing(hp, sim);
    case 'ironHulk': return new IronHulk(hp, sim);
    case 'broodMother': return new BroodMother(hp, sim);
    case 'warden': return new Warden(hp, sim);
    case 'gateEater': return new GateEater(hp, sim);
  }
}

export const BOSS_NAMES: Record<BossKind, string> = {
  bruteKing: 'Brute King', ironHulk: 'Iron Hulk', broodMother: 'Brood Mother', warden: 'The Warden', gateEater: 'Gate Eater',
};
