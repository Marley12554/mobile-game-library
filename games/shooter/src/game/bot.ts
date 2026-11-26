/**
 * A heuristic player for headless tuning. It is not a good player: it can't
 * plan routes or read boss patterns the way a person learns them. It's a
 * yardstick. If the bot wins easily, the level is probably too slack. If the
 * bot never wins on any loadout, check the level by hand.
 */
import { TRACK_HALF } from './config';
import { ENEMIES } from './enemies';
import type { Sim, Gate } from './sim';
import { WEAPONS } from './weapons';

export interface BotMem { next: number; x: number }

export function newBot(): BotMem { return { next: 0, x: 0 } }

function gateValue(sim: Sim, g: Gate): number {
  const n = sim.count;
  let v = 0;
  // Flip gates: judge the state the gate will be in when we get there.
  let mods = sim.gateMods(g);
  if (g.alt && sim.scrollNow > 0) {
    const arrive = sim.time + (g.y - sim.squadY) / sim.scrollNow;
    mods = Math.floor(arrive / g.period) % 2 === 1 ? g.alt : g.mods;
  }
  for (const m of mods) {
    switch (m.k) {
      case 'add': v += m.v > 0 ? m.v * sim.stats.addMul : m.v; break;
      case 'mul': v += n * (m.v - 1); break;
      case 'div': v -= n * (1 - 1 / m.v); break;
      case 'fire': case 'dmg': v += n * (m.v - 1) * 0.8; break;
      case 'pierce': v += n * 0.25 * m.v; break;
      case 'weapon': v += 0; break;
    }
  }
  return v;
}

export function botStep(sim: Sim, mem: BotMem): void {
  if (sim.time < mem.next) { sim.targetX = mem.x; return; }
  mem.next = sim.time + 0.1;
  const w = sim.world;
  const fr = Math.max(14, sim.formationR * 0.8);
  const wd = WEAPONS[sim.weapon];
  const range = wd.speed * wd.life;
  const dps = sim.count * wd.dmg * wd.rate * sim.fireMult * sim.dmgMult * sim.stats.dmg * sim.stats.fire * wd.spread.length;
  let best = sim.leaderX, bestS = -Infinity;
  for (let x = -TRACK_HALF + 15; x <= TRACK_HALF - 15; x += 12) {
    let s = -Math.abs(x - sim.leaderX) * 0.004;
    // Enemies we'd be shooting at.
    for (const i of sim.enemies) {
      if (sim.eDead[i]) continue;
      const dy = w.y[i] - sim.squadY;
      if (dy < -10 || dy > range) continue;
      const d = ENEMIES[sim.kindOf(i)];
      if (Math.abs(w.x[i] - x) < fr + d.r) s += (d.bites * 1.2) / (1 + dy / 140);
    }
    // Gates we'd pass through.
    for (const g of sim.gates) {
      if (g.gone || g.used || g.passed) continue;
      const dy = g.y - sim.squadY;
      if (dy < 0 || dy > 420) continue;
      const inside = Math.abs(x - g.x) < g.w / 2 - 8;
      if (!inside) continue;
      const v = gateValue(sim, g);
      const urgency = dy < 160 ? 3 : 1.2;
      s += v * urgency;
      if (sim.gateAbsorbs(g) && dy > 140 && v < 0) s += 4; // worth shooting up
    }
    // Prizes we could finish in time.
    for (const p of sim.prizes) {
      if (p.state !== 'frozen') continue;
      const dy = p.y - sim.squadY;
      if (dy < 0 || dy > range + 100) continue;
      if (Math.abs(x - p.x) > p.w / 2 + fr * 0.5) continue;
      const time = dy / Math.max(1, sim.scrollNow);
      if (dps * sim.stats.prize * time > p.hp * 0.9) s += 10;
    }
    // Boss: stand under it, dodge telegraphs and spears.
    if (sim.boss && !sim.boss.dead) {
      if (Math.abs(x - sim.boss.x) < sim.boss.r + fr) s += 6;
      for (const h of sim.hazards) {
        if (h.kind === 'rect' && x + fr * 0.6 > h.x0 && x - fr * 0.6 < h.x1 && h.y0 <= sim.squadY && h.y1 >= sim.squadY) s -= 500;
      }
      for (const m of sim.missiles) if (m.kind === 'spear' && Math.abs(m.x - x) < fr + 8) s -= 300;
    }
    if (s > bestS) { bestS = s; best = x; }
  }
  mem.x = best;
  sim.targetX = best;
}
